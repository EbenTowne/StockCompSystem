from datetime import date
from decimal import ROUND_HALF_UP, Decimal
import math
from typing import Optional
from django.utils import timezone
from django.db.models import Sum
from rest_framework import serializers
from dateutil.relativedelta import relativedelta # type: ignore
from accounts.models import UserProfile
from .models         import Series, StockClass, EquityGrant

def _normal_cdf(x: float) -> float:
    return (1.0 + math.erf(x / math.sqrt(2.0))) / 2.0

# ────────────────────────────────
#  HELPER FUNCTION TO COMPUTE BLACK SCHOLES
# ────────────────────────────────
def bs_call_price(S: float, K: float, T: float, r: float, sigma: float) -> float:
    S = float(S)
    K = float(K)
    if S <= 0:
        return 0.0
    if K <= 0:
        return S
    if T <= 0:
        return max(0.0, S - K)
    if sigma <= 0:
        return max(0.0, S - K * math.exp(-r * T))
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    return S * _normal_cdf(d1) - K * math.exp(-r * T) * _normal_cdf(d2)

def safe_dec(x) -> Decimal:
    if x is None or x == "":
        return Decimal("0")
    return Decimal(str(x))

def months_between(d1: date, d2: date) -> int:
    """Whole months between two dates (order-agnostic)."""
    if not d1 or not d2:
        return 0
    if d2 < d1:
        d1, d2 = d2, d1
    r = relativedelta(d2, d1)
    return r.years * 12 + r.months

def clamp(n: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, n))

# ────────────────────────────────
#  CREATE SERIES FOR COMPANY CLASSES
# ────────────────────────────────
class SeriesSerializer(serializers.ModelSerializer):
    class Meta:
        model = Series
        fields = ["id", "name", "share_type"]

# ────────────────────────────────
#  CREATE CLASSES FOR STOCK ALLOC
# ────────────────────────────────
class StockClassSerializer(serializers.ModelSerializer):
    # Computed helpers (unchanged)
    shares_allocated = serializers.IntegerField(read_only=True)
    shares_remaining = serializers.IntegerField(read_only=True)

    # Read-only nested series for UI
    series = SeriesSerializer(read_only=True)

    # Class share_type mirrors selected series (read-only to API)
    share_type = serializers.CharField(read_only=True)

    # Require selecting a Series by id (scoped in __init__)
    series_id = serializers.PrimaryKeyRelatedField(
        source="series",
        queryset=Series.objects.none(),   # set in __init__,
        write_only=True,
        required=True,
        help_text="Provide the Series by id (scoped to your company).",
    )

    class Meta:
        model = StockClass
        fields = [
            "id",
            "name",
            "share_type",           # read-only, inferred from series
            "total_class_shares",
            "shares_allocated",
            "shares_remaining",
            "series",               # read-only nested
            "series_id",            # write-only (required)
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        company = getattr(getattr(getattr(request, "user", None), "profile", None), "company", None)
        if company:
            self.fields["series_id"].queryset = Series.objects.filter(company=company)

    def _company_and_instance(self):
        request = self.context.get("request")
        company = getattr(getattr(getattr(request, "user", None), "profile", None), "company", None)
        if not company:
            raise serializers.ValidationError("Unable to determine your company.")
        return company, getattr(self, "instance", None)

    def validate(self, attrs):
        """
        Enforce: sum(company.stock_classes.total_class_shares) <= company.total_authorized_shares
        Works for both create and update.
        """
        # Ensure a series is provided (defensive)
        if not attrs.get("series") and not getattr(getattr(self, "instance", None), "series", None):
            raise serializers.ValidationError({"series": "Series is required."})

        company, instance = self._company_and_instance()

        # What will the new total_class_shares be for this row?
        new_shares = attrs.get("total_class_shares")
        if new_shares is None and instance is not None:
            new_shares = instance.total_class_shares or 0
        new_shares = int(new_shares or 0)

        # Sum all other classes in the company (exclude self on update)
        qs = company.stock_classes.all()
        if instance is not None:
            qs = qs.exclude(pk=instance.pk)

        other_total = qs.aggregate(total=Sum("total_class_shares"))["total"] or 0
        proposed_company_total = int(other_total) + int(new_shares)

        cap = int(company.total_authorized_shares or 0)
        if cap and proposed_company_total > cap:
            remaining = max(0, cap - int(other_total))
            raise serializers.ValidationError({
                "total_class_shares": (
                    f"Allocation exceeds company Total Authorized Shares "
                    f"({cap:,}). You can allocate at most {remaining:,} shares to this class."
                )
            })

        return attrs

    def create(self, validated_data):
        request = self.context.get("request")
        company = getattr(getattr(getattr(request, "user", None), "profile", None), "company", None)
        if not company:
            raise serializers.ValidationError("Unable to determine your company.")

        series = validated_data["series"]
        # mirror series share type
        validated_data["share_type"] = series.share_type
        validated_data["company"] = company
        return super().create(validated_data)

    def update(self, instance, validated_data):
        # keep class type in sync if series changes
        series = validated_data.get("series", instance.series)
        validated_data["share_type"] = series.share_type
        validated_data.pop("company", None)  # company immutable via API
        return super().update(instance, validated_data)

# ────────────────────────────────
#  CREATE STOCK OPTION / GRANT
# ────────────────────────────────
class EquityGrantSerializer(serializers.ModelSerializer):
    user = serializers.SlugRelatedField(
        queryset=UserProfile.objects.all(), slug_field='unique_id', write_only=True
    )
    stock_class = serializers.SlugRelatedField(
        queryset=StockClass.objects.none(),
        slug_field='name',
        write_only=True,
    )
    vesting_frequency = serializers.ChoiceField(
        choices=EquityGrant.VESTING_FREQUENCIES, default='MONTHLY'
    )
    cliff_months = serializers.SerializerMethodField()
    shares_per_period = serializers.SerializerMethodField()

    class Meta:
        model = EquityGrant
        fields = [
            'id','user','stock_class',
            'num_shares','iso_shares','nqo_shares','rsu_shares',
            'common_shares','preferred_shares',
            'strike_price','purchase_price','grant_date',
            'vesting_start','vesting_end',
            'cliff_months','vesting_frequency','shares_per_period',
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        req = self.context.get('request')
        if req and hasattr(req.user, 'profile'):
            company = req.user.profile.company
            self.fields['stock_class'].queryset = StockClass.objects.filter(company=company)

    def validate(self, data):
        total   = data.get('num_shares', getattr(self.instance, 'num_shares', 0)) or 0
        iso     = data.get('iso_shares', getattr(self.instance, 'iso_shares', 0)) or 0
        nqo     = data.get('nqo_shares', getattr(self.instance, 'nqo_shares', 0)) or 0
        rsu     = data.get('rsu_shares', getattr(self.instance, 'rsu_shares', 0)) or 0
        common  = data.get('common_shares', getattr(self.instance, 'common_shares', 0)) or 0
        pref    = data.get('preferred_shares', getattr(self.instance, 'preferred_shares', 0)) or 0

        # Exclusivity
        if iso and nqo:
            raise serializers.ValidationError({"nqo_shares": "ISO and NQO cannot exist in the same grant."})

        buckets = [iso, nqo, rsu, common, pref]
        if sum(1 for b in buckets if b > 0) != 1 or (iso + nqo + rsu + common + pref) != total:
            raise serializers.ValidationError({
                "num_shares": "Grant must represent one exclusive share type and total must equal num_shares."
            })

        # Pricing rules
        strike  = data.get('strike_price', getattr(self.instance, 'strike_price', None))
        purch   = data.get('purchase_price', getattr(self.instance, 'purchase_price', None))

        if iso or nqo:
            if not strike or strike <= 0:
                raise serializers.ValidationError({"strike_price": "ISO/NQO require positive strike_price."})
            if purch and purch > 0:
                raise serializers.ValidationError({"purchase_price": "ISO/NQO cannot have purchase_price."})

        if rsu:
            if strike and strike > 0:
                raise serializers.ValidationError({"strike_price": "RSUs cannot have strike_price."})
            if purch and purch > 0:
                raise serializers.ValidationError({"purchase_price": "RSUs cannot have purchase_price."})

        if common:
            if not purch or purch <= 0:
                raise serializers.ValidationError({"purchase_price": "Common shares require purchase_price."})
            if strike and strike > 0:
                raise serializers.ValidationError({"strike_price": "Common shares cannot have strike_price."})

        if pref:
            if not purch or purch <= 0:
                raise serializers.ValidationError({"purchase_price": "Preferred shares require purchase_price."})
            if strike and strike > 0:
                raise serializers.ValidationError({"strike_price": "Preferred shares cannot have strike_price."})

        # Class/series consistency
        stock_class = data.get("stock_class", getattr(self.instance, "stock_class", None))
        if stock_class and isinstance(stock_class, StockClass):
            if pref and stock_class.share_type != "PREFERRED":
                raise serializers.ValidationError({"stock_class": "Preferred grants must use Preferred class/series."})
            if (iso or nqo or rsu or common) and stock_class.share_type != "COMMON":
                raise serializers.ValidationError({"stock_class": "ISO/NQO/RSU/Common grants must use Common class/series."})

        vs, ve = data.get("vesting_start"), data.get("vesting_end")
        if vs and ve and ve < vs:
            raise serializers.ValidationError({"vesting_end": "vesting_end must be after vesting_start."})

        # ── NEW: Enforce stock-class allocation cap ───────────────────────────
        # Do not allow this grant to push the class beyond total_class_shares.
        sc = stock_class
        if sc:
            qs = sc.equity_grants.all()
            if self.instance and getattr(self.instance, "pk", None):
                qs = qs.exclude(pk=self.instance.pk)
            already = qs.aggregate(total=Sum("num_shares"))["total"] or 0
            proposed = int(already) + int(total)
            if proposed > int(sc.total_class_shares or 0):
                remaining = max(0, int(sc.total_class_shares or 0) - int(already))
                raise serializers.ValidationError({
                    "num_shares": (
                        f"Insufficient shares in class '{sc.name}'. "
                        f"Remaining: {remaining:,}; requested: {int(total):,}."
                    )
                })
        # ──────────────────────────────────────────────────────────────────────

        return data

    def get_cliff_months(self, obj):
        today = timezone.now().date()
        if not obj.vesting_start:
            return 0
        rd = relativedelta(today, obj.vesting_start) if today >= obj.vesting_start else relativedelta(obj.vesting_start, today)
        return rd.years * 12 + rd.months

    def get_shares_per_period(self, obj):
        if not obj.vesting_start or not obj.vesting_end or obj.num_shares == 0:
            return 0
        rd = relativedelta(obj.vesting_end, obj.vesting_start)
        freq = (obj.vesting_frequency or '').lower()
        days = (obj.vesting_end - obj.vesting_start).days
        if freq == 'daily': units = days
        elif freq == 'weekly': units = days // 7
        elif freq == 'biweekly': units = days // 14
        elif freq == 'yearly': units = rd.years
        else: units = rd.years * 12 + rd.months
        return obj.num_shares // units if units > 0 else 0

# ────────────────────────────────
#  GENERATE CAP TABLE FOR ALL GRANT INFO
# ────────────────────────────────
class CapTableSerializer(serializers.Serializer):
    unique_id = serializers.CharField()
    name = serializers.CharField()
    stock_class = serializers.CharField()
    series_name = serializers.SerializerMethodField()
    isos = serializers.IntegerField()
    nqos = serializers.IntegerField()
    rsus = serializers.IntegerField()
    common_shares = serializers.IntegerField()
    preferred_shares = serializers.IntegerField()
    total_shares = serializers.IntegerField()
    strike_price = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    purchase_price = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)  # ← ADDED
    ownership_pct = serializers.FloatField()
    vesting_start = serializers.SerializerMethodField()
    vesting_end   = serializers.SerializerMethodField()

    cliff_months = serializers.SerializerMethodField()
    total_vesting_months = serializers.IntegerField()
    remaining_vesting_months = serializers.IntegerField()
    vesting_status = serializers.CharField()

    current_share_price = serializers.FloatField()
    risk_free_rate = serializers.FloatField()
    volatility = serializers.FloatField()

    def get_grant(self, obj) -> EquityGrant:
        grant = obj.get('grant_obj')
        if not isinstance(grant, EquityGrant):
            raise serializers.ValidationError("Missing EquityGrant instance")
        return grant

    def get_vesting_start(self, obj):
        return self.get_grant(obj).vesting_start

    def get_vesting_end(self, obj):
        return self.get_grant(obj).vesting_end

    def get_cliff_months(self, obj) -> int:
        grant = self.get_grant(obj)
        if not grant.vesting_start:
            return 0
        today = timezone.now().date()
        rd = relativedelta(today, grant.vesting_start) if today >= grant.vesting_start else relativedelta(grant.vesting_start, today)
        return rd.years * 12 + rd.months
    
    def get_series_name(self, obj):
        grant = self.get_grant(obj)
        if grant.stock_class and grant.stock_class.series:
            return grant.stock_class.series.name
        return "N/A"

# ────────────────────────────────
#  GENERATE DETAILED INFO FOR SPECIFIC GRANT
# ────────────────────────────────
class EmployeeGrantDetailSerializer(serializers.ModelSerializer):
    # identifiers / labels
    id = serializers.IntegerField(read_only=True)
    unique_id = serializers.CharField(source="user.unique_id", read_only=True)
    name = serializers.CharField(source="user.user.first_name", read_only=True)
    stock_class_name = serializers.CharField(source="stock_class.name", read_only=True)
    series_name = serializers.CharField(source="stock_class.series.name", read_only=True)

    # company FMV (per-share)
    fmv = serializers.SerializerMethodField(read_only=True)

    # computed vesting outputs
    vested_shares = serializers.SerializerMethodField(read_only=True)
    unvested_shares = serializers.SerializerMethodField(read_only=True)
    vesting_period_months = serializers.SerializerMethodField(read_only=True)
    remaining_vesting_months = serializers.SerializerMethodField(read_only=True)
    vesting_status = serializers.SerializerMethodField(read_only=True)

    # values shown in UI
    vested_value = serializers.SerializerMethodField(read_only=True)
    grant_date = serializers.SerializerMethodField(read_only=True)

    # computed fields referenced by the UI
    cliff_months = serializers.SerializerMethodField(read_only=True)
    shares_per_period = serializers.SerializerMethodField(read_only=True)

    # optional convenience for the UI (dollars per vesting unit)
    per_period_shares = serializers.SerializerMethodField(read_only=True)
    per_period_value  = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = EquityGrant
        fields = [
            "id", "unique_id", "name", "stock_class_name", "series_name",
            "num_shares", "iso_shares", "nqo_shares", "rsu_shares",
            "common_shares", "preferred_shares",
            "strike_price", "purchase_price",
            "vesting_start", "vesting_end", "cliff_months",
            "vesting_frequency", "shares_per_period",
            "vested_shares", "unvested_shares",
            "vesting_period_months", "remaining_vesting_months", "vesting_status",
            "fmv", "vested_value", "grant_date",
            "per_period_shares", "per_period_value",
        ]
        read_only_fields = fields

    # ---------- simple accessors (unchanged) ----------
    def get_fmv(self, obj):
        company = getattr(obj.user, "company", None)
        if not company:
            return None
        val = getattr(company, "current_share_price", None)
        if val in (None, ""):
            val = getattr(company, "current_fmv", None)
        return val

    def get_grant_date(self, obj):
        return obj.grant_date

    def get_cliff_months(self, obj) -> int:
        if not obj.vesting_start:
            return 0
        today = timezone.now().date()
        rd = relativedelta(today, obj.vesting_start) if today >= obj.vesting_start \
             else relativedelta(obj.vesting_start, today)
        return rd.years * 12 + rd.months

    # ---------- vesting unit helpers (unchanged) ----------
    def _units_total(self, g) -> int:
        if not g.vesting_start or not g.vesting_end:
            return 0
        start, end = g.vesting_start, g.vesting_end
        days_total = (end - start).days
        freq = (g.vesting_frequency or "").lower()
        rd = relativedelta(end, start)

        if days_total < 31:
            return max(days_total, 1)

        if freq == "daily":
            return max(days_total, 1)
        if freq == "weekly":
            return max(days_total // 7, 1)
        if freq == "biweekly":
            return max(days_total // 14, 1)
        if freq == "yearly":
            return max(rd.years, 1)

        months = rd.years * 12 + rd.months
        return max(months, 1)

    def _units_elapsed(self, g, today: date) -> int:
        if not g.vesting_start:
            return 0
        cliff_months = int(getattr(g, "cliff_months", 0) or 0)
        start_after_cliff = g.vesting_start + relativedelta(months=+cliff_months)
        if today < start_after_cliff:
            return 0
        end = g.vesting_end or today
        stop = min(today, end)
        days_elapsed = (stop - start_after_cliff).days
        freq = (g.vesting_frequency or "").lower()
        rd = relativedelta(stop, start_after_cliff)

        if (g.vesting_end and (g.vesting_end - g.vesting_start).days < 31) or freq == "daily":
            return max(days_elapsed, 0)
        if freq == "weekly":
            return max(days_elapsed // 7, 0)
        if freq == "biweekly":
            return max(days_elapsed // 14, 0)
        if freq == "yearly":
            return max(rd.years, 0)

        months = rd.years * 12 + rd.months
        return max(months, 0)

    # ---------- CHANGES START HERE ----------
    def get_vested_shares(self, obj) -> int:
        # Trust the model (handles Preferred immediate vest)
        return int(obj.vested_shares())

    def get_unvested_shares(self, obj) -> int:
        total = int(obj.num_shares or 0)
        return max(0, total - self.get_vested_shares(obj))

    def get_vesting_period_months(self, obj) -> int:
        # Preferred immediate → no period
        if (obj.preferred_shares or 0) > 0:
            return 0
        if not obj.vesting_start or not obj.vesting_end:
            return 0
        rd = relativedelta(obj.vesting_end, obj.vesting_start)
        return rd.years * 12 + rd.months

    def get_remaining_vesting_months(self, obj) -> int:
        if (obj.preferred_shares or 0) > 0:
            return 0
        if not obj.vesting_end:
            return 0
        today = date.today()
        rd = relativedelta(obj.vesting_end, today)
        return max(rd.years * 12 + rd.months, 0)

    def get_vesting_status(self, obj) -> str:
        if (obj.preferred_shares or 0) > 0:
            return "Preferred Shares (Immediate Vest)"
        vested = self.get_vested_shares(obj)
        total = int(obj.num_shares or 0)
        if vested <= 0:
            return "Not Vested"
        if vested >= total > 0:
            return "Fully Vested"
        return "Partially Vested"
    # ---------- CHANGES END HERE ----------

    # ---------- value math (unchanged) ----------
    def _bucket_prices(self, obj) -> tuple[Decimal, Decimal, Decimal]:
        strike   = Decimal(str(obj.strike_price or 0))
        purchase = Decimal(str(obj.purchase_price or 0))
        fmv      = Decimal(str(self.get_fmv(obj) or 0))
        return strike, purchase, fmv

    def get_vested_value(self, obj):
        total = int(obj.num_shares or 0)
        vested_total = int(self.get_vested_shares(obj) or 0)
        if total <= 0 or vested_total <= 0:
            return 0.0

        iso = int(obj.iso_shares or 0)
        nqo = int(obj.nqo_shares or 0)
        rsu = int(obj.rsu_shares or 0)
        common = int(obj.common_shares or 0)
        pref = int(obj.preferred_shares or 0)

        strike, purchase, fmv = self._bucket_prices(obj)

        frac = Decimal(vested_total) / Decimal(total)
        v_iso  = int((Decimal(iso)   * frac).to_integral_value(rounding=ROUND_HALF_UP))
        v_nqo  = int((Decimal(nqo)   * frac).to_integral_value(rounding=ROUND_HALF_UP))
        v_rsu  = int((Decimal(rsu)   * frac).to_integral_value(rounding=ROUND_HALF_UP))
        v_comm = int((Decimal(common)* frac).to_integral_value(rounding=ROUND_HALF_UP))
        v_pref = int((Decimal(pref)  * frac).to_integral_value(rounding=ROUND_HALF_UP))

        value = (
            (Decimal(v_iso + v_nqo) * strike) +
            (Decimal(v_rsu)         * fmv) +
            (Decimal(v_comm + v_pref) * purchase)
        ).quantize(Decimal("0.01"))
        return float(value)

    # per-period helpers (unchanged, with Preferred handled above)
    def get_shares_per_period(self, obj) -> int:
        if (obj.preferred_shares or 0) > 0:
            return int(obj.num_shares or 0)
        units = self._units_total(obj)
        total = int(obj.num_shares or 0)
        return (total // units) if units > 0 else 0

    def get_per_period_shares(self, obj) -> int:
        return self.get_shares_per_period(obj)

    def get_per_period_value(self, obj):
        shares = self.get_per_period_shares(obj)
        if shares <= 0:
            return 0.0

        iso_nqo = int(obj.iso_shares or 0) + int(obj.nqo_shares or 0)
        rsu = int(obj.rsu_shares or 0)
        common_pref = int(obj.common_shares or 0) + int(obj.preferred_shares or 0)

        strike, purchase, fmv = self._bucket_prices(obj)

        kinds = sum(1 for x in (iso_nqo, rsu, common_pref) if x > 0)
        if kinds <= 1:
            price = strike if iso_nqo > 0 else (fmv if rsu > 0 else purchase)
        else:
            total = Decimal(iso_nqo + rsu + common_pref) or Decimal(1)
            price = (
                (Decimal(iso_nqo) * strike) +
                (Decimal(rsu) * fmv) +
                (Decimal(common_pref) * purchase)
            ) / total

        return float((Decimal(shares) * price).quantize(Decimal("0.01")))

# ────────────────────────────────
#  GENERATE CAP TABLE CONTAINING BLACK SCHOLES INFO
# ────────────────────────────────
class BlackScholesCapTableSerializer(serializers.Serializer):
    unique_id = serializers.CharField()
    name = serializers.CharField()
    stock_class = serializers.CharField()
    isos = serializers.IntegerField()
    nqos = serializers.IntegerField()
    rsus = serializers.IntegerField()
    common_shares = serializers.IntegerField()
    preferred_shares = serializers.IntegerField()
    total_shares = serializers.IntegerField()
    strike_price = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    ownership_pct = serializers.FloatField()
    vesting_start = serializers.SerializerMethodField()
    vesting_end   = serializers.SerializerMethodField()
    cliff_months = serializers.SerializerMethodField()
    total_vesting_months = serializers.IntegerField()
    remaining_vesting_months = serializers.IntegerField()
    vesting_status = serializers.CharField()

    current_share_price = serializers.FloatField()
    risk_free_rate = serializers.FloatField()
    volatility = serializers.FloatField()
    bso_value_per_option = serializers.SerializerMethodField()
    total_expense = serializers.SerializerMethodField()
    annual_expense = serializers.SerializerMethodField()
    black_scholes_iso_expense = serializers.SerializerMethodField()

    def get_grant(self, obj) -> EquityGrant:
        grant = obj.get('grant_obj')
        if not isinstance(grant, EquityGrant):
            raise serializers.ValidationError("Missing EquityGrant instance")
        return grant

    def get_vesting_start(self, obj):
        return self.get_grant(obj).vesting_start

    def get_vesting_end(self, obj):
        return self.get_grant(obj).vesting_end

    def get_cliff_months(self, obj) -> int:
        grant = self.get_grant(obj)
        if not grant.vesting_start:
            return 0
        today = timezone.now().date()
        rd = relativedelta(today, grant.vesting_start) if today >= grant.vesting_start else relativedelta(grant.vesting_start, today)
        return rd.years * 12 + rd.months

    def get_bso_value_per_option(self, obj) -> float:
        S = obj['current_share_price']
        grant = self.get_grant(obj)
        K = float(grant.strike_price or 0)
        today = timezone.now().date()
        end = grant.vesting_end or today
        T = max((end - today).days, 0) / 365.0
        r = obj['risk_free_rate']
        sigma = obj['volatility']
        return round(bs_call_price(S, K, T, r, sigma), 6)

    def get_black_scholes_iso_expense(self, obj) -> float:
        grant = self.get_grant(obj)
        bso = self.get_bso_value_per_option(obj)
        return round((grant.iso_shares + grant.nqo_shares) * bso, 2)

    def get_total_expense(self, obj) -> float:
        grant = self.get_grant(obj)
        S = obj['current_share_price']
        option_expense = self.get_black_scholes_iso_expense(obj)
        stock_units = grant.rsu_shares + grant.common_shares + grant.preferred_shares
        stock_expense = S * stock_units
        return round(option_expense + stock_expense, 2)

    def get_annual_expense(self, obj) -> float:
        total = self.get_total_expense(obj)
        grant = self.get_grant(obj)
        vs, ve = grant.vesting_start, grant.vesting_end
        if grant.preferred_shares > 0 or not (vs and ve and ve > vs):
            return round(total, 2)
        months = (ve.year - vs.year) * 12 + (ve.month - vs.month)
        years = months / 12 if months > 0 else 1
        return round(total / years, 2)