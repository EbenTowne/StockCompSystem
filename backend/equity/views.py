from django.utils import timezone
from decimal import Decimal
import math
from django.shortcuts            import get_object_or_404
from dateutil.relativedelta      import relativedelta  # type: ignore # ensure python-dateutil is installed
from rest_framework.views        import APIView
from rest_framework.response     import Response
from rest_framework              import generics, permissions, status

from accounts.models             import UserProfile
from accounts.permissions        import IsEmployer
from .models                     import StockClass, EquityGrant
from .serializers                import (
    BlackScholesCapTableSerializer,
    StockClassSerializer,
    EquityGrantSerializer,
    CapTableSerializer,
    EmployeeGrantDetailSerializer
)

class StockClassListCreateView(generics.ListCreateAPIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    serializer_class   = StockClassSerializer
    def get_queryset(self):
        return self.request.user.profile.company.stock_classes.all()
    def perform_create(self, serializer):
        serializer.save(company=self.request.user.profile.company)

class StockClassDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    serializer_class   = StockClassSerializer
    lookup_field       = 'pk'
    def get_queryset(self):
        return self.request.user.profile.company.stock_classes.all()

class EquityGrantListCreateView(generics.ListCreateAPIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    serializer_class   = EquityGrantSerializer
    def get_queryset(self):
        return EquityGrant.objects.filter(user__company=self.request.user.profile.company)
    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data, context={'request': request})
        ser.is_valid(raise_exception=True)
        grant = ser.save()
        detail = EmployeeGrantDetailSerializer(grant).data
        return Response(detail, status=status.HTTP_201_CREATED)

class EmployeeGrantDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET, PUT, PATCH, DELETE
    /api/equity/employees/<unique_id>/grants/<grant_id>/
    """
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    serializer_class   = EmployeeGrantDetailSerializer
    lookup_field       = 'id'
    lookup_url_kwarg   = 'grant_id'
    def get_queryset(self):
        return EquityGrant.objects.filter(
            user__company   = self.request.user.profile.company,
            user__unique_id = self.kwargs['unique_id']
        )

class CapTableView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    def get(self, request):
        company     = request.user.profile.company
        cap         = company.total_authorized_shares
        all_grants  = EquityGrant.objects.filter(user__company=company)
        allocated   = sum(g.num_shares for g in all_grants)
        unallocated = cap - allocated if cap else 0

        class_allocs = [
            {
                'stock_class': sc.name,
                'allocated':   sc.shares_allocated,
                'remaining':   sc.shares_remaining
            }
            for sc in company.stock_classes.all()
        ]

        rows  = []
        today = timezone.now().date()
        for profile in UserProfile.objects.filter(company=company):
            grants = list(profile.equity_grants.all())
            # sum per type
            iso       = sum(g.iso_shares    for g in grants)
            nqo       = sum(g.nqo_shares    for g in grants)
            rsu       = sum(g.rsu_shares    for g in grants)
            common    = sum(g.common_shares for g in grants)
            preferred = sum(g.preferred_shares for g in grants)
            total     = iso + nqo + rsu + common + preferred
            if total == 0:
                continue
            pct = round(total / cap * 100, 2) if cap else 0.0

            # vesting metadata
            if preferred > 0:
                total_m = rem_m = cliff = 0
            else:
                first = grants[0]
                if first.vesting_start and first.vesting_end:
                    rd = relativedelta(first.vesting_end, first.vesting_start)
                    total_m = rd.years*12 + rd.months
                    rem   = relativedelta(first.vesting_end, today)
                    rem_m = max(rem.years*12 + rem.months, 0)
                    cliff = first.cliff_months
                else:
                    total_m = rem_m = cliff = 0

            vested = sum(g.vested_shares(on_date=today) for g in grants if g.preferred_shares == 0) + preferred
            unvested = total - vested
            if preferred > 0:
                status = 'Preferred (Immediate Vest)'
            else:
                status = 'Not Vested' if vested == 0 else 'Fully Vested' if unvested <= 0 else 'Vesting'

            rows.append({
                'unique_id':                profile.unique_id,
                'name':                     profile.user.first_name or profile.user.username,
                'stock_class':              grants[0].stock_class.name,
                'isos':                     iso,
                'nqos':                     nqo,
                'rsus':                     rsu,
                'common_shares':            common,
                'preferred_shares':         preferred,
                'total_shares':             total,
                'strike_price':             grants[0].strike_price,
                'ownership_pct':            pct,
                'total_vesting_months':     total_m,
                'remaining_vesting_months': rem_m,
                'vesting_start':            grants[0].vesting_start,
                'vesting_end':              grants[0].vesting_end,
                'vesting_status':           status,
                'cliff_months':             cliff,
            })

        return Response({
            'market_cap':             cap,
            'allocated_market_cap':   allocated,
            'unallocated_market_cap': unallocated,
            'class_allocations':      class_allocs,
            'rows':                   CapTableSerializer(rows, many=True).data
        })
    
class BlackScholesCapTableView(APIView):
    permission_classes = [ permissions.IsAuthenticated ]

    def get(self, request):
        company   = request.user.profile.company
        cap       = company.total_authorized_shares
        rows      = []
        today     = timezone.now().date()

        for profile in UserProfile.objects.filter(company=company, role='employee'):
            grants = list(profile.equity_grants.all())
            if not grants:
                continue

            # aggregate counts…
            iso, nqo, rsu, common, pref = (
                sum(g.iso_shares       for g in grants),
                sum(g.nqo_shares       for g in grants),
                sum(g.rsu_shares       for g in grants),
                sum(g.common_shares    for g in grants),
                sum(g.preferred_shares for g in grants),
            )
            total = iso + nqo + rsu + common + pref
            pct   = round(total / cap * 100, 2) if cap else 0.0

            # vesting metrics based on first grant…
            g0 = grants[0]
            if pref:
                tot_m = rem_m = cliff = 0
            elif g0.vesting_start and g0.vesting_end:
                rd    = relativedelta(g0.vesting_end, g0.vesting_start)
                tot_m = rd.years * 12 + rd.months
                rem   = relativedelta(g0.vesting_end, today)
                rem_m = max(rem.years * 12 + rem.months, 0)
                cliff = g0.cliff_months
            else:
                tot_m = rem_m = cliff = 0

            rows.append({
                'unique_id':               profile.unique_id,
                'name':                    profile.user.first_name,
                'stock_class':             g0.stock_class.name,
                'isos':                    iso,
                'nqos':                    nqo,
                'rsus':                    rsu,
                'common_shares':           common,
                'preferred_shares':        pref,
                'total_shares':            total,
                'ownership_pct':           pct,
                'total_vesting_months':    tot_m,
                'remaining_vesting_months':rem_m,
                'cliff_months':            cliff,
                'vesting_status':          g0.get_vesting_status(),
                'strike_price':            g0.strike_price,
                'grant_obj':               g0,
                'current_share_price':     float(company.current_share_price),
                'risk_free_rate':          float(company.risk_free_rate),
                'volatility':              float(company.volatility),
            })

        return Response({
            'market_cap': cap,
            'rows':       BlackScholesCapTableSerializer(rows, many=True).data,
        })
    
class GrantVestingScheduleView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    def get(self, request, unique_id, grant_id):
        grant = get_object_or_404(
            EquityGrant,
            pk=grant_id,
            user__unique_id=unique_id,
            user__company=request.user.profile.company
        )
        return Response({
            'grant':    EmployeeGrantDetailSerializer(grant).data,
            'schedule': grant.vesting_schedule_breakdown()
        })
    
class AllGrantVestingScheduleView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    def get(self, request):
        company = request.user.profile.company
        schedules = []
        for profile in UserProfile.objects.filter(company=company):
            for grant in profile.equity_grants.all():
                sched = grant.vesting_schedule_breakdown()
                if sched:
                    schedules.append({
                        'unique_id': profile.unique_id,
                        'name':      profile.user.first_name or profile.user.username,
                        'grant_id':  grant.pk,
                        'schedule':  sched
                    })
        return Response({'schedules': schedules})

class EmployeeGrantDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    def delete(self, request, unique_id):
        profile = get_object_or_404(
            UserProfile,
            unique_id=unique_id,
            company=request.user.profile.company
        )
        count, _ = EquityGrant.objects.filter(user=profile).delete()
        return Response({'deleted_grants': count}, status=status.HTTP_200_OK)
    
class GrantIDListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, unique_id):
        # ensure the employee exists in your company
        employee = get_object_or_404(
            UserProfile,
            unique_id=unique_id,
            company=request.user.profile.company,
            role='employee'
        )
        # fetch their grants
        grants = EquityGrant.objects.filter(user=employee)
        grant_ids = [g.id for g in grants]
        return Response(
            { 'grant_ids': grant_ids },
            status=status.HTTP_200_OK
        )