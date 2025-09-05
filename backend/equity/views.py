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
    
class GrantMonthlyExpensesView(APIView):
    """
    Per-grant straight-line monthly expense from the current month through the last
    month this grant recognizes expense.

    Options (ISO/NQO): Black-Scholes value * option count, amortized over vesting months.
    RSU/Common with schedule: FMV * shares, amortized over vesting months.
    Immediate-vest (e.g., Preferred w/o schedule or purchased Common): full amount in grant month.
    """
    permission_classes = [permissions.IsAuthenticated, IsEmployer]

    # --- month helpers ---
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

    # --- back-compat / human-friendly aliases so existing calls work ---
    start_of_month = _first_of_month
    each_month     = _month_iter
    count_months   = _months_between

    def get(self, request, unique_id: str, grant_id: int):
        # 1) Resolve grant
        grant = get_object_or_404(
            EquityGrant,
            pk=grant_id,
            user__unique_id=unique_id,
            user__company=request.user.profile.company
        )

        company: Company = request.user.profile.company
        share_price = float(company.current_share_price or 0.0)
        risk_free   = float(company.risk_free_rate or 0.0)
        volatility  = float(company.volatility or 0.0)

        today         = timezone.now().date()
        current_month = self.start_of_month(today)

        # 2) Compute fair-value components
        iso_nqo = (grant.iso_shares or 0) + (grant.nqo_shares or 0)
        rsu     = grant.rsu_shares or 0
        common  = grant.common_shares or 0
        pref    = grant.preferred_shares or 0

        # Options: Black–Scholes
        strike = float(grant.strike_price or 0.0)
        if iso_nqo > 0 and share_price > 0 and strike > 0 and volatility > 0:
            vest_end = grant.vesting_end or today
            years_to_end = max((vest_end - today).days, 0) / 365.0
            try:
                option_value = bs_call_price(S=share_price, K=strike, T=years_to_end, r=risk_free, sigma=volatility)
            except Exception:
                option_value = 0.0
            option_total = round(iso_nqo * option_value, 2)
        else:
            option_total = 0.0

        # RSUs: FMV × shares
        rsu_total = round(share_price * rsu, 2) if share_price > 0 and rsu > 0 else 0.0

        # Common / Preferred: (FMV − purchase) × shares (floor at 0)
        raw_pp = grant.purchase_price  # Decimal or None
        purchase_price = float(raw_pp) if raw_pp is not None else share_price
        disc = max(share_price - purchase_price, 0.0)

        common_total = round(disc * common, 2) if common > 0 else 0.0
        pref_total   = round(disc * pref,   2) if pref   > 0 else 0.0

        total_value = round(option_total + rsu_total + common_total + pref_total, 2)

        # 3) Last month to include
        if pref and not (grant.vesting_start and grant.vesting_end):
            last_month = self.start_of_month(grant.grant_date)
        elif grant.vesting_end:
            last_month = self.start_of_month(grant.vesting_end)
        else:
            last_month = self.start_of_month(grant.grant_date)

        # 4) Allocate across months
        monthly = defaultdict(float)

        if total_value == 0.0:
            months_out = [{"month": m.strftime("%Y-%m"), "expense": 0.0}
                          for m in self.each_month(current_month, last_month)]
            return Response({
                "employee_unique_id": grant.user.unique_id,
                "grant_id": grant.id,
                "stock_class": getattr(grant.stock_class, "name", "N/A"),
                "start_month": current_month.strftime("%Y-%m"),
                "end_month": last_month.strftime("%Y-%m"),
                "total_expense_fair_value": 0.0,
                "months": months_out,
                "grand_total_within_window": 0.0,
            })

        # Immediate-vest cases
        stock_units = rsu + common + pref
        if (pref > 0 and not (grant.vesting_start and grant.vesting_end)) \
           or (stock_units > 0 and not (grant.vesting_start and grant.vesting_end) and iso_nqo == 0):
            mkey = self.start_of_month(grant.grant_date)
            if mkey >= current_month:
                monthly[mkey] += total_value
        else:
            # Straight-line amortization
            if grant.vesting_start and grant.vesting_end and grant.vesting_end > grant.vesting_start:
                months = self.count_months(grant.vesting_start, grant.vesting_end) + 1
                if months <= 0:
                    mkey = self.start_of_month(grant.vesting_start or grant.grant_date)
                    if mkey >= current_month:
                        monthly[mkey] += total_value
                else:
                    per_month = total_value / months
                    first = self.start_of_month(grant.vesting_start)
                    for m in self.each_month(first, grant.vesting_end):
                        if m < current_month:
                            continue
                        if m > last_month:
                            break
                        monthly[m] += per_month
            else:
                mkey = self.start_of_month(grant.grant_date)
                if mkey >= current_month:
                    monthly[mkey] += total_value

        # 5) Build response
        months_out = []
        grand = 0.0
        for m in self.each_month(current_month, last_month):
            amt = round(monthly[m], 2)
            grand += amt
            months_out.append({"month": m.strftime("%Y-%m"), "expense": amt})

        return Response({
            "employee_unique_id": grant.user.unique_id,
            "grant_id": grant.id,
            "stock_class": getattr(grant.stock_class, "name", "N/A"),
            "start_month": current_month.strftime("%Y-%m"),
            "end_month": last_month.strftime("%Y-%m"),
            "total_expense_fair_value": total_value,
            "months": months_out,
            "grand_total_within_window": round(grand, 2),
        })
    
class CompanyMonthlyExpensesView(APIView):
    """
    Company-wide straight-line monthly expenses from the current month through the
    latest month any grant recognizes expense.
    """
    permission_classes = [permissions.IsAuthenticated, IsEmployer]

    def get(self, request):
        company: Company = request.user.profile.company

        share_price = float(company.current_share_price or 0.0)
        r           = float(company.risk_free_rate or 0.0)
        sigma       = float(company.volatility or 0.0)

        today       = timezone.now().date()
        start_month = GrantMonthlyExpensesView.start_of_month(today)

        grants = (
            EquityGrant.objects
            .filter(user__company=company, user__role='employee')
            .select_related('user__user', 'stock_class')
        )

        monthly_totals = defaultdict(float)
        latest_last_month = start_month
        company_total_fair_value = 0.0

        def allocate_grant(grant: EquityGrant):
            nonlocal latest_last_month, company_total_fair_value

            iso_nqo = (grant.iso_shares or 0) + (grant.nqo_shares or 0)
            rsu     = grant.rsu_shares or 0
            common  = grant.common_shares or 0
            pref    = grant.preferred_shares or 0

            # Options: Black–Scholes
            strike = float(grant.strike_price or 0.0)
            if iso_nqo > 0 and share_price > 0 and strike > 0 and sigma > 0:
                horizon_end = grant.vesting_end or today
                T_years = max((horizon_end - today).days, 0) / 365.0
                try:
                    bso_per = bs_call_price(S=share_price, K=strike, T=T_years, r=r, sigma=sigma)
                except Exception:
                    bso_per = 0.0
                option_total = round(iso_nqo * bso_per, 2)
            else:
                option_total = 0.0

            # RSUs: FMV × shares
            rsu_total = round(share_price * rsu, 2) if share_price > 0 and rsu > 0 else 0.0

            # Common / Preferred: (FMV − purchase) × shares (floor at 0)
            raw_pp = grant.purchase_price
            purchase_price = float(raw_pp) if raw_pp is not None else share_price
            disc = max(share_price - purchase_price, 0.0)

            common_total = round(disc * common, 2) if common > 0 else 0.0
            pref_total   = round(disc * pref,   2) if pref   > 0 else 0.0

            total_value = round(option_total + rsu_total + common_total + pref_total, 2)
            company_total_fair_value += total_value

            # Determine last month for this grant
            if pref and not (grant.vesting_start and grant.vesting_end):
                last_month = GrantMonthlyExpensesView.start_of_month(grant.grant_date)
            elif grant.vesting_end:
                last_month = GrantMonthlyExpensesView.start_of_month(grant.vesting_end)
            else:
                last_month = GrantMonthlyExpensesView.start_of_month(grant.grant_date)

            if last_month > latest_last_month:
                latest_last_month = last_month

            if total_value == 0.0:
                return

            # Immediate-vest
            stock_units = rsu + common + pref
            if (pref > 0 and not (grant.vesting_start and grant.vesting_end)) or \
               (stock_units > 0 and not (grant.vesting_start and grant.vesting_end) and iso_nqo == 0):
                mkey = GrantMonthlyExpensesView.start_of_month(grant.grant_date)
                if mkey >= start_month:
                    monthly_totals[mkey] += total_value
            else:
                # Straight-line amortization
                if grant.vesting_start and grant.vesting_end and grant.vesting_end > grant.vesting_start:
                    months = GrantMonthlyExpensesView.count_months(grant.vesting_start, grant.vesting_end) + 1
                    if months <= 0:
                        mkey = GrantMonthlyExpensesView.start_of_month(grant.vesting_start or grant.grant_date)
                        if mkey >= start_month:
                            monthly_totals[mkey] += total_value
                    else:
                        per_month = total_value / months
                        first = GrantMonthlyExpensesView.start_of_month(grant.vesting_start)
                        for m in GrantMonthlyExpensesView.each_month(first, grant.vesting_end):
                            if m < start_month:
                                continue
                            if m > last_month:
                                break
                            monthly_totals[m] += per_month
                else:
                    mkey = GrantMonthlyExpensesView.start_of_month(grant.grant_date)
                    if mkey >= start_month:
                        monthly_totals[mkey] += total_value

        for g in grants:
            allocate_grant(g)

        months_out = []
        grand = 0.0
        cur = start_month
        while cur <= latest_last_month:
            amt = round(monthly_totals[cur], 2)
            grand += amt
            months_out.append({"month": cur.strftime("%Y-%m"), "expense": amt})
            cur = cur + relativedelta(months=1)

        return Response({
            "company_id": company.id,
            "start_month": start_month.strftime("%Y-%m"),
            "end_month": latest_last_month.strftime("%Y-%m"),
            "total_expense_fair_value": round(company_total_fair_value, 2),
            "months": months_out,
            "grand_total_within_window": round(grand, 2),
        })


# ------------------------------------------------------------
# Optional: Black-Scholes “cap table” preview for all grants
# (Safe against None/invalid inputs)
# ------------------------------------------------------------
class BlackScholesCapTableView(APIView):
    """
    Returns a simple list of grants with computed Black–Scholes per-option value and totals.
    Useful for debugging inputs and ensuring no NoneType/float conversion errors.
    """
    permission_classes = [permissions.IsAuthenticated, IsEmployer]

    def get(self, request):
        company: Company = request.user.profile.company
        S     = float(company.current_share_price or 0.0)
        r     = float(company.risk_free_rate or 0.0)
        sigma = float(company.volatility or 0.0)

        today = timezone.now().date()

        rows = []
        total_value = 0.0

        grants = (
            EquityGrant.objects
            .filter(user__company=company)
            .select_related('user__user', 'stock_class')
        )

        for g in grants:
            iso_nqo = (g.iso_shares or 0) + (g.nqo_shares or 0)
            K = float(g.strike_price or 0.0)

            if iso_nqo > 0 and S > 0 and K > 0 and sigma > 0:
                horizon_end = g.vesting_end or today
                T_years = max((horizon_end - today).days, 0) / 365.0
                try:
                    per = bs_call_price(S=S, K=K, T=T_years, r=r, sigma=sigma)
                except Exception:
                    per = 0.0
                opt_total = round(per * iso_nqo, 2)
            else:
                per = 0.0
                opt_total = 0.0

            rows.append({
                "employee": getattr(g.user, "unique_id", None),
                "grant_id": g.id,
                "stock_class": getattr(g.stock_class, "name", "N/A"),
                "purchase_price": float(g.purchase_price or 0.0),
                "option_shares": iso_nqo,
                "strike_price": K,
                "S": S,
                "r": r,
                "sigma": sigma,
                "T_years": float(max(((g.vesting_end or today) - today).days, 0) / 365.0),
                "bs_call_per_option": round(per, 6),
                "option_total_value": opt_total,
            })
            total_value += opt_total

        return Response({
            "company_id": company.id,
            "as_of": today.isoformat(),
            "total_option_value": round(total_value, 2),
            "grants": rows,
        })