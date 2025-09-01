from django.utils import timezone
from decimal import Decimal
import math
from django.shortcuts            import get_object_or_404
from dateutil.relativedelta      import relativedelta  # type: ignore # ensure python-dateutil is installed
from rest_framework.views        import APIView
from rest_framework.response     import Response
from rest_framework              import generics, permissions, status
from rest_framework.exceptions import ValidationError
from accounts.models             import UserProfile
from accounts.permissions        import IsEmployer
from .models                     import Series, StockClass, EquityGrant
from .serializers                import (
    BlackScholesCapTableSerializer,
    SeriesSerializer,
    StockClassSerializer,
    EquityGrantSerializer,
    CapTableSerializer,
    EmployeeGrantDetailSerializer,
    bs_call_price
)

class SeriesListCreateView(generics.ListCreateAPIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    serializer_class = SeriesSerializer

    def get_queryset(self):
        return Series.objects.filter(company=self.request.user.profile.company)

    def perform_create(self, serializer):
        # Automatically assign the company of the logged-in employer
        serializer.save(company=self.request.user.profile.company)
    
class SeriesDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    serializer_class = SeriesSerializer
    queryset = Series.objects.all()

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        series_name = instance.name
        self.perform_destroy(instance)
        return Response(
            {"detail": f"Series '{series_name}' and all associated classes and grants were deleted."},
            status=status.HTTP_204_NO_CONTENT
        )

class StockClassListCreateView(generics.ListCreateAPIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    serializer_class = StockClassSerializer

    def get_queryset(self):
        return self.request.user.profile.company.stock_classes.all()

    def perform_create(self, serializer):
        serializer.save(company=self.request.user.profile.company)

    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except Exception as e:
            return Response(
                {"detail": f"Error creating stock class: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST
            )

class StockClassDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    serializer_class = StockClassSerializer
    lookup_field = 'pk'

    def get_queryset(self):
        return self.request.user.profile.company.stock_classes.all()

class EquityGrantListCreateView(generics.ListCreateAPIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    serializer_class = EquityGrantSerializer

    def get_queryset(self):
        return EquityGrant.objects.filter(user__company=self.request.user.profile.company)

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data, context={'request': request})
        try:
            ser.is_valid(raise_exception=True)
            grant = ser.save()
            detail = EmployeeGrantDetailSerializer(grant).data
            return Response(detail, status=status.HTTP_201_CREATED)
        except ValidationError as e:
            return Response({"errors": e.detail}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

class EmployeeGrantDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    serializer_class = EmployeeGrantDetailSerializer
    lookup_field = 'id'
    lookup_url_kwarg = 'grant_id'

    def get_queryset(self):
        return EquityGrant.objects.filter(
            user__company=self.request.user.profile.company,
            user__unique_id=self.kwargs['unique_id']
        )

class CapTableView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]

    def get(self, request):
        company = request.user.profile.company
        cap = company.total_authorized_shares
        all_grants = EquityGrant.objects.filter(user__company=company)
        allocated = sum(g.num_shares for g in all_grants)
        unalloc = cap - allocated if cap else 0

        class_allocs = [
            {
                "stock_class": sc.name,
                "allocated": sc.shares_allocated,
                "remaining": sc.shares_remaining,
            }
            for sc in company.stock_classes.all()
        ]

        rows = []
        today = timezone.now().date()

        for grant in all_grants:
            user = grant.user
            total = grant.num_shares
            pct = round((total / cap) * 100, 2) if cap else 0.0

            if grant.preferred_shares:
                tot_m = rem_m = cliff = 0
            elif grant.vesting_start and grant.vesting_end:
                rd = relativedelta(grant.vesting_end, grant.vesting_start)
                tot_m = rd.years * 12 + rd.months
                rem = relativedelta(grant.vesting_end, today)
                rem_m = max(rem.years * 12 + rem.months, 0)
                cliff = grant.cliff_months
            else:
                tot_m = rem_m = cliff = 0

            rows.append({
                "unique_id": user.unique_id,
                "name": user.user.first_name or user.user.username,
                "stock_class": grant.stock_class.name,
                "isos": grant.iso_shares,
                "nqos": grant.nqo_shares,
                "rsus": grant.rsu_shares,
                "common_shares": grant.common_shares,
                "preferred_shares": grant.preferred_shares,
                "total_shares": total,
                "ownership_pct": pct,
                "total_vesting_months": tot_m,
                "remaining_vesting_months": rem_m,
                "cliff_months": cliff,
                "vesting_status": grant.get_vesting_status(),
                "strike_price": grant.strike_price,
                "purchase_price": grant.purchase_price,
                "current_share_price": float(company.current_share_price),
                "risk_free_rate": float(company.risk_free_rate),
                "volatility": float(company.volatility),
                "grant_obj": grant,
            })

        return Response({
            "market_cap": cap,
            "allocated_market_cap": allocated,
            "unallocated_market_cap": unalloc,
            "class_allocations": class_allocs,
            "rows": CapTableSerializer(rows, many=True).data
        })
    
class BlackScholesCapTableView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]

    def get(self, request):
        company = request.user.profile.company
        cap = company.total_authorized_shares or 0
        rows = []
        today = timezone.now().date()

        grants = (
            EquityGrant.objects
            .filter(user__company=company, user__role='employee')
            .select_related('user__user', 'stock_class__series')
        )

        for grant in grants:
            user = grant.user
            total = grant.num_shares or 0
            ownership_pct = round((total / cap) * 100, 2) if cap else 0.0

            # --- vesting metrics (keep simple & safe) ---
            if (grant.preferred_shares or 0) > 0:
                total_vesting_months = remaining_vesting_months = cliff_months = 0
                vesting_status = 'Preferred Shares (Immediate Vest)'
            elif grant.vesting_start and grant.vesting_end:
                rd_total = relativedelta(grant.vesting_end, grant.vesting_start)
                total_vesting_months = rd_total.years * 12 + rd_total.months
                rd_rem = relativedelta(grant.vesting_end, today)
                remaining_vesting_months = max(rd_rem.years * 12 + rd_rem.months, 0)
                cliff_months = getattr(grant, 'cliff_months', 0)
                vesting_status = getattr(grant, 'get_vesting_status', lambda: 'Vesting')()
            else:
                total_vesting_months = remaining_vesting_months = cliff_months = 0
                vesting_status = 'Not Vested'

            # --- BSO inputs (guard against None) ---
            is_option = (grant.iso_shares or 0) + (grant.nqo_shares or 0) > 0

            S = float(company.current_share_price or 0)
            K = float(grant.strike_price or 0)
            r = float(company.risk_free_rate or 0)
            sigma = float(company.volatility or 0)
            T = 1  # years; adjust if you store an explicit horizon

            if is_option and S > 0 and K > 0 and sigma > 0:
                try:
                    bso_fmv = bs_call_price(S=S, K=K, T=T, r=r, sigma=sigma)
                except Exception:
                    bso_fmv = 0.0
            elif (grant.rsu_shares or 0) > 0:
                # RSUs are not options; per-share fair value ≈ current FMV
                bso_fmv = S
            else:
                # Not an option and not an RSU (e.g., preferred/common) → N/A
                # Keep 0.0 to satisfy serializers.FloatField()
                bso_fmv = 0.0

            rows.append({
                'unique_id': user.unique_id,
                'name': getattr(user.user, 'first_name', '') or user.user.username,
                'stock_class': grant.stock_class.name if grant.stock_class else "N/A",
                'isos': grant.iso_shares,
                'nqos': grant.nqo_shares,
                'rsus': grant.rsu_shares,
                'common_shares': grant.common_shares,
                'preferred_shares': grant.preferred_shares,
                'total_shares': total,
                'ownership_pct': ownership_pct,
                'total_vesting_months': total_vesting_months,
                'remaining_vesting_months': remaining_vesting_months,
                'cliff_months': cliff_months,
                'vesting_status': vesting_status,
                'strike_price': grant.strike_price,
                'grant_obj': grant,  # required so serializer can compute series_name
                'current_share_price': S,
                'risk_free_rate': r,
                'volatility': sigma,
                'bso_fmv': bso_fmv,
            })

        return Response({
            'market_cap': cap,
            'rows': BlackScholesCapTableSerializer(rows, many=True).data,
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

    def get(self, request, unique_id):
        # List all grants for that employee
        profile = get_object_or_404(
            UserProfile,
            unique_id=unique_id,
            company=request.user.profile.company
        )
        grants = EquityGrant.objects.filter(user=profile)
        serializer = EmployeeGrantDetailSerializer(grants, many=True)
        return Response(serializer.data)

    def delete(self, request, unique_id):
        # Delete all grants for that employee
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