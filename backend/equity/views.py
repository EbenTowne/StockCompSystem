from collections import defaultdict
from datetime import date
from django.utils import timezone
from decimal import Decimal
import math
from django.shortcuts            import get_object_or_404
from dateutil.relativedelta      import relativedelta  # type: ignore # ensure python-dateutil is installed
from rest_framework.views        import APIView
from rest_framework.response     import Response
from rest_framework              import generics, permissions, status
from rest_framework.exceptions import ValidationError
from accounts.models             import Company, UserProfile
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
    
class CompanyMonthlyExpensesView(APIView):
    """
    Returns straight-line monthly expense totals for all grants in the employer's company,
    from the current month (inclusive) through the last month of the longest-lasting grant.

    For options (ISO/NQO): Black–Scholes option FMV * option count, amortized evenly across vesting months.
    For RSUs/Common with vesting: current FMV * share count, amortized evenly across vesting months.
    For immediate-vest (e.g., Preferred w/o vesting dates or purchased Common): entire expense in grant month.
    """
    permission_classes = [permissions.IsAuthenticated, IsEmployer]

    def _first_of_month(self, d: date) -> date:
        return date(d.year, d.month, 1)

    def _month_iter(self, start: date, end: date):
        """Yield first-of-month dates from start..end inclusive."""
        cur = date(start.year, start.month, 1)
        last = date(end.year, end.month, 1)
        while cur <= last:
            yield cur
            cur = cur + relativedelta(months=1)

    def _months_between(self, start: date, end: date) -> int:
        """Whole-month count like elsewhere in code (exclusive of the end month’s day count)."""
        rd = relativedelta(end, start)
        return rd.years * 12 + rd.months

    def get(self, request):
        company = request.user.profile.company
        S = float(company.current_share_price or 0.0)
        r = float(company.risk_free_rate or 0.0)
        sigma = float(company.volatility or 0.0)

        today = timezone.now().date()
        start_month = self._first_of_month(today)

        grants = (
            EquityGrant.objects
            .filter(user__company=company, user__role='employee')
            .select_related('user__user', 'stock_class__series')
        )

        # Determine the last month to cover
        last_month = start_month
        for g in grants:
            if g.vesting_end:
                cand = self._first_of_month(g.vesting_end)
            else:
                # immediate recognition goes in the grant month
                cand = self._first_of_month(g.grant_date)
            if cand > last_month:
                last_month = cand

        # Accumulate expense per month
        monthly_totals = defaultdict(float)

        for g in grants:
            iso_nqo = (g.iso_shares or 0) + (g.nqo_shares or 0)
            rsu = g.rsu_shares or 0
            common = g.common_shares or 0
            preferred = g.preferred_shares or 0

            # ----- Compute per-grant TOTAL fair-value expense (same logic family as BlackScholesCapTable) -----
            # Options
            if iso_nqo > 0 and S > 0 and float(g.strike_price or 0) > 0 and sigma > 0:
                # Horizon: time from today to vesting_end (bounded at 0)
                ve = g.vesting_end or today
                T = max((ve - today).days, 0) / 365.0
                bso_per = bs_call_price(S=S, K=float(g.strike_price), T=T, r=r, sigma=sigma)
                option_expense_total = round(iso_nqo * bso_per, 2)
            else:
                option_expense_total = 0.0

            # Stock units at FMV (RSU/common/preferred)
            stock_units = rsu + common + preferred
            stock_expense_total = round(S * stock_units, 2)

            total_expense = round(option_expense_total + stock_expense_total, 2)

            # ----- Allocate across months -----
            if (preferred > 0 and not (g.vesting_start and g.vesting_end)) \
               or (stock_units > 0 and not (g.vesting_start and g.vesting_end) and iso_nqo == 0):
                # Immediate vest (preferred without vesting dates, or purchased shares without a schedule)
                month_key = self._first_of_month(g.grant_date)
                if month_key >= start_month:
                    monthly_totals[month_key] += total_expense
                # If the grant month is before our window, we ignore (already expensed historically)
                continue

            # If we have a proper vesting window, amortize straight-line by whole months
            if g.vesting_start and g.vesting_end and g.vesting_end > g.vesting_start:
                vest_months = self._months_between(g.vesting_start, g.vesting_end)
                if vest_months <= 0:
                    # fallback: recognize in vest_start month
                    month_key = self._first_of_month(g.vesting_start)
                    if month_key >= start_month:
                        monthly_totals[month_key] += total_expense
                    continue

                per_month = total_expense / vest_months

                # Distribute month-by-month from vest_start to vest_end-logic (same month counting as elsewhere)
                first = self._first_of_month(g.vesting_start)
                for m in self._month_iter(first, g.vesting_end):
                    if m < start_month:
                        continue
                    # Stop at last_month cap
                    if m > last_month:
                        break
                    monthly_totals[m] += per_month
            else:
                # No usable schedule → treat as immediate in grant month
                month_key = self._first_of_month(g.grant_date)
                if month_key >= start_month:
                    monthly_totals[month_key] += total_expense

        # Build response rows
        months = []
        grand_total = 0.0
        for m in self._month_iter(start_month, last_month):
            amt = round(monthly_totals[m], 2)
            grand_total += amt
            months.append({
                "month": m.strftime("%Y-%m"),
                "total_monthly_expense": amt
            })

        return Response({
            "company": company.name,
            "start_month": start_month.strftime("%Y-%m"),
            "end_month": last_month.strftime("%Y-%m"),
            "months": months,
            "grand_total": round(grand_total, 2),
        })

class GrantMonthlyExpensesView(APIView):
    """
    Per-grant straight-line monthly expense from the current month through the last
    month this grant recognizes expense.

    Options (ISO/NQO): Black-Scholes value * option count, amortized over vesting months.
    RSU/Common with schedule: FMV * shares, amortized over vesting months.
    Immediate-vest (e.g., Preferred w/o schedule or purchased Common): full amount in grant month.
    """
    permission_classes = [permissions.IsAuthenticated, IsEmployer]

    @staticmethod
    def _first_of_month(d: date) -> date:
        return date(d.year, d.month, 1)

    @staticmethod
    def _month_iter(start: date, end: date):
        cur = date(start.year, start.month, 1)
        last = date(end.year, end.month, 1)
        while cur <= last:
            yield cur
            cur = cur + relativedelta(months=1)

    @staticmethod
    def _months_between(start: date, end: date) -> int:
        rd = relativedelta(end, start)
        return rd.years * 12 + rd.months

    def get(self, request, unique_id: str, grant_id: int):
        # 1) Resolve grant (scoped to the employer's company + that employee)
        grant = get_object_or_404(
            EquityGrant,
            pk=grant_id,
            user__unique_id=unique_id,
            user__company=request.user.profile.company
        )

        company: Company = request.user.profile.company
        S     = float(company.current_share_price or 0.0)
        r     = float(company.risk_free_rate or 0.0)
        sigma = float(company.volatility or 0.0)

        today       = timezone.now().date()
        start_month = self._first_of_month(today)

        # 2) Compute total fair-value expense for this grant
        iso_nqo = (grant.iso_shares or 0) + (grant.nqo_shares or 0)
        rsu     = grant.rsu_shares or 0
        common  = grant.common_shares or 0
        pref    = grant.preferred_shares or 0

        # Options piece (Black–Scholes)
        if iso_nqo > 0 and S > 0 and float(grant.strike_price or 0) > 0 and sigma > 0:
            horizon_end = grant.vesting_end or today
            T_years = max((horizon_end - today).days, 0) / 365.0
            bso_per = bs_call_price(S=S, K=float(grant.strike_price or 0), T=T_years, r=r, sigma=sigma)
            option_total = round(iso_nqo * bso_per, 2)
        else:
            option_total = 0.0

        # Stock-unit piece at FMV (RSU/Common/Preferred)
        stock_units   = rsu + common + pref
        stock_total   = round(S * stock_units, 2)
        total_expense = round(option_total + stock_total, 2)

        # 3) Determine last month to include for this grant
        if pref and not (grant.vesting_start and grant.vesting_end):
            last_month = self._first_of_month(grant.grant_date)
        elif grant.vesting_end:
            last_month = self._first_of_month(grant.vesting_end)
        else:
            last_month = self._first_of_month(grant.grant_date)

        # 4) Allocate across months
        monthly = defaultdict(float)

        # Immediate-vest cases
        if (pref > 0 and not (grant.vesting_start and grant.vesting_end)) \
           or (stock_units > 0 and not (grant.vesting_start and grant.vesting_end) and iso_nqo == 0):
            mkey = self._first_of_month(grant.grant_date)
            if mkey >= start_month:
                monthly[mkey] += total_expense
        else:
            # Straight-line amortization across vesting months
            if grant.vesting_start and grant.vesting_end and grant.vesting_end > grant.vesting_start:
                months = self._months_between(grant.vesting_start, grant.vesting_end)
                if months <= 0:
                    mkey = self._first_of_month(grant.vesting_start or grant.grant_date)
                    if mkey >= start_month:
                        monthly[mkey] += total_expense
                else:
                    per_month = total_expense / months
                    first = self._first_of_month(grant.vesting_start)
                    for m in self._month_iter(first, grant.vesting_end):
                        if m < start_month:
                            continue
                        if m > last_month:
                            break
                        monthly[m] += per_month
            else:
                mkey = self._first_of_month(grant.grant_date)
                if mkey >= start_month:
                    monthly[mkey] += total_expense

        # 5) Build response
        months_out = []
        grand = 0.0
        for m in self._month_iter(start_month, last_month):
            amt = round(monthly[m], 2)
            grand += amt
            months_out.append({
                "month": m.strftime("%Y-%m"),
                "expense": amt
            })

        return Response({
            "employee_unique_id": grant.user.unique_id,
            "grant_id": grant.id,
            "stock_class": grant.stock_class.name,
            "start_month": start_month.strftime("%Y-%m"),
            "end_month": last_month.strftime("%Y-%m"),
            "total_expense_fair_value": total_expense,
            "months": months_out,
            "grand_total_within_window": round(grand, 2),
        })