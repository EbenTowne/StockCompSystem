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
        ser   = self.get_serializer(data=request.data, context={'request': request})
        ser.is_valid(raise_exception=True)
        grant = ser.save()
        detail = EmployeeGrantDetailSerializer(grant).data
        return Response(detail, status=status.HTTP_201_CREATED)


class EmployeeGrantDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    serializer_class   = EmployeeGrantDetailSerializer
    lookup_field       = 'grant_id'

    def get_object(self):
        return get_object_or_404(
            EquityGrant,
            pk=self.kwargs['grant_id'],
            user__unique_id=self.kwargs['unique_id'],
            user__company=self.request.user.profile.company
        )

    def update(self, request, *args, **kwargs):
        grant = self.get_object()
        ser   = EquityGrantSerializer(grant, data=request.data, partial=True, context={'request': request})
        ser.is_valid(raise_exception=True)
        grant = ser.save()
        detail = EmployeeGrantDetailSerializer(grant).data
        return Response(detail)

    def destroy(self, request, *args, **kwargs):
        self.get_object().delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


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
            grants    = list(profile.equity_grants.all())
            iso       = sum(g.iso_shares   for g in grants)
            nso       = sum(g.nso_shares   for g in grants)
            rsu       = sum(g.rsu_shares   for g in grants)
            common    = sum(g.common_shares for g in grants)
            preferred = sum(g.preferred_shares for g in grants)

            total = iso + nso + rsu + common + preferred
            if total == 0:
                continue

            pct = round(total / cap * 100, 2) if cap else 0.0

            # preferred grants get zero vesting/cliff
            if preferred > 0:
                total_months     = 0
                remaining_months = 0
                cliff_months     = 0
            else:
                if grants and grants[0].vesting_start and grants[0].vesting_end:
                    rd              = relativedelta(grants[0].vesting_end,
                                                   grants[0].vesting_start)
                    total_months     = rd.years * 12 + rd.months
                    rd_rem           = relativedelta(grants[0].vesting_end, today)
                    remaining_months = max(rd_rem.years * 12 + rd_rem.months, 0)
                    cliff_months     = grants[0].cliff_months
                else:
                    total_months     = 0
                    remaining_months = 0
                    cliff_months     = 0

            # compute vested shares
            vested_time = sum(
                g.vested_shares(on_date=today)
                for g in grants
                if g.preferred_shares == 0
            )
            vested   = vested_time + preferred
            unvested = total - vested

            # determine status
            if preferred > 0:
                status = 'Preferred (Immediate Vest)'
            else:
                if vested == 0:
                    status = 'Not Vested'
                elif unvested <= 0:
                    status = 'Fully Vested'
                else:
                    status = 'Vesting'

            rows.append({
                'unique_id':                profile.unique_id,
                'name':                     profile.user.first_name or profile.user.username,
                'stock_class':              grants[0].stock_class.name if grants else '–',
                'isos':                     iso,
                'nqos':                     nso,
                'rsus':                     rsu,
                'common_shares':            common,
                'preferred_shares':         preferred,
                'total_shares':             total,
                'ownership_pct':            pct,
                'total_vesting_months':     total_months,
                'remaining_vesting_months': remaining_months,
                'cliff_months':             cliff_months,
                'vesting_status':           status,
                'strike_price':             grants[0].strike_price if grants else None,
            })

        return Response({
            'market_cap':             cap,
            'allocated_market_cap':   allocated,
            'unallocated_market_cap': unallocated,
            'class_allocations':      class_allocs,
            'rows':                   CapTableSerializer(rows, many=True).data
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

        start = grant.vesting_start
        end   = grant.vesting_end
        today = timezone.now().date()

        if not (start and end):
            return Response({
                'grant':    EmployeeGrantDetailSerializer(grant).data,
                'schedule': []
            })

        # 1) total full months in the vesting window
        rd_total     = relativedelta(end, start)
        total_months = rd_total.years * 12 + rd_total.months

        # 2) month‐offset from start to current month
        m_start = (today.year  - start.year) * 12 + \
                  (today.month - start.month)

        schedule = []
        for m in range(m_start, total_months + 1):
            date_m = start + relativedelta(months=m)
            # 3) clamp to end if we overshoot
            if date_m > end:
                date_m = end
            # 4) include it
            schedule.append({
                'date':          date_m.isoformat(),
                'vested_shares': grant.vested_shares(on_date=date_m)
            })

        return Response({
            'grant':    EmployeeGrantDetailSerializer(grant).data,
            'schedule': schedule
        })
    

class AllGrantVestingScheduleView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]

    def get(self, request):
        company       = request.user.profile.company
        all_schedules = []

        for profile in UserProfile.objects.filter(company=company):
            for grant in profile.equity_grants.all():
                start = grant.vesting_start
                end   = grant.vesting_end
                if not (start and end):
                    continue

                days_total = (end - start).days
                sched      = []
                idx        = 0
                current    = start

                while current <= end:
                    elapsed = (current - start).days
                    vested  = int(grant.num_shares * elapsed / days_total) if days_total else grant.num_shares
                    expense = None
                    if grant.strike_price is not None:
                        expense = str((grant.strike_price * vested).quantize(Decimal('0.01')))
                    sched.append({
                        'month_index':     idx + 1,
                        'date':            current.isoformat(),
                        'vested_shares':   vested,
                        'unvested_shares': grant.num_shares - vested,
                        'expense':         expense,
                    })
                    idx     += 1
                    current  = start + relativedelta(months=idx)

                all_schedules.append({
                    'unique_id': profile.unique_id,
                    'name':      profile.user.first_name or profile.user.username,
                    'grant_id':  grant.pk,
                    'schedule':  sched
                })

        return Response({'schedules': all_schedules})
    

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