import math
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

# ────────────────────────────────
#  CREATE SERIES FOR COMPANY CLASSES
# ────────────────────────────────
class SeriesSerializer(serializers.ModelSerializer):
    class Meta:
        model = Series
        fields = ['id', 'name', 'share_type', 'created_at']

# ────────────────────────────────
#  CREATE CLASSES FOR STOCK ALLOC
# ────────────────────────────────
class StockClassSerializer(serializers.ModelSerializer):
    shares_allocated = serializers.IntegerField(read_only=True)
    shares_remaining = serializers.IntegerField(read_only=True)
    series = SeriesSerializer(read_only=True)
    series_id = serializers.PrimaryKeyRelatedField(
        queryset=Series.objects.all(), source='series', write_only=True, required=False, allow_null=True, default=None,help_text="Leave blank for ISO/NQO/RSU share pools. Only required for preferred/common rounds."
    )

    class Meta:
        model = StockClass
        fields = [
            'id', 'name', 'total_class_shares',
            'shares_allocated', 'shares_remaining',
            'series', 'series_id'
        ]

    def validate_total_class_shares(self, value):
        request = self.context['request']
        company = request.user.profile.company
        others = company.stock_classes.exclude(pk=self.instance.pk) if self.instance else company.stock_classes.all()
        if sum(c.total_class_shares for c in others) + value > company.total_authorized_shares:
            raise serializers.ValidationError(
                f"Total across classes cannot exceed market cap ({company.total_authorized_shares})"
            )
        return value
        return value

# ────────────────────────────────
#  CREATE STOCK OPTION / GRANT
# ────────────────────────────────
class EquityGrantSerializer(serializers.ModelSerializer):
    user = serializers.SlugRelatedField(
        queryset=UserProfile.objects.all(), slug_field='unique_id', write_only=True
    )
    stock_class = serializers.SlugRelatedField(
        queryset=StockClass.objects.none(),  # set at runtime
        slug_field='name',
        write_only=True,
    )
    vesting_frequency = serializers.ChoiceField(
        choices=EquityGrant.VESTING_FREQUENCIES,
        default='MONTHLY'
    )
    cliff_months = serializers.SerializerMethodField()
    shares_per_period = serializers.SerializerMethodField()

    class Meta:
        model = EquityGrant
        fields = [
            'id', 'user', 'stock_class',
            'num_shares', 'iso_shares', 'nqo_shares', 'rsu_shares',
            'common_shares', 'preferred_shares',
            'strike_price', 'purchase_price', 'grant_date',
            'vesting_start', 'vesting_end',
            'cliff_months', 'vesting_frequency', 'shares_per_period',
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request and hasattr(request.user, 'profile'):
            company = request.user.profile.company
            self.fields['stock_class'].queryset = StockClass.objects.filter(company=company)

    def validate(self, data):
        total = data.get('num_shares', getattr(self.instance, 'num_shares', 0))
        iso = data.get('iso_shares', getattr(self.instance, 'iso_shares', 0))
        nqo = data.get('nqo_shares', getattr(self.instance, 'nqo_shares', 0))
        rsu = data.get('rsu_shares', getattr(self.instance, 'rsu_shares', 0))
        common = data.get('common_shares', getattr(self.instance, 'common_shares', 0))
        pref = data.get('preferred_shares', getattr(self.instance, 'preferred_shares', 0))

        if iso + nqo + rsu + common + pref != total:
            raise serializers.ValidationError({'num_shares':
                "Sum of ISO, NQO, RSU, Common, Preferred must equal total_shares"
            })
        if pref and (iso or nqo or rsu or common):
            raise serializers.ValidationError({'preferred_shares':
                "Preferred shares cannot be mixed with ISO/NQO/RSU/Common"
            })
        if rsu and (iso or nqo):
            raise serializers.ValidationError({
                'rsu_shares': "RSUs cannot be mixed with ISO or NQO shares in the same grant."
            })
        

        sp = data.get('strike_price', getattr(self.instance, 'strike_price', None))
        pp = data.get('purchase_price', getattr(self.instance, 'purchase_price', None))

        if (iso or nqo) and (not sp or sp <= 0):
            raise serializers.ValidationError({'strike_price':
                "Must provide a positive strike price for ISO/NQO/RSU grants"
            })

        if rsu and sp and (sp > 0 or sp < 0):
            raise serializers.ValidationError({
                'strike_price': "RSUs must not have a strike price greater than 0."
            })

        if common:
            if not (sp and sp > 0) and not (pp and pp > 0):
                raise serializers.ValidationError({'common_shares':
                    "Common shares require either a strike price or purchase price"
                })

        if pref and (not pp or pp <= 0):
            raise serializers.ValidationError({'purchase_price':
                "Preferred shares require a positive purchase price"
            })

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
        freq = obj.vesting_frequency.lower()
        days = (obj.vesting_end - obj.vesting_start).days
        if freq == 'daily':    units = days
        elif freq == 'weekly': units = days // 7
        elif freq == 'biweekly': units = days // 14
        elif freq == 'yearly': units = rd.years
        else: units = rd.years * 12 + rd.months
        return obj.num_shares // units if units > 0 else 0

    def create(self, validated_data):
        return super().create(validated_data)

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
    unique_id = serializers.CharField(source='user.unique_id', read_only=True)
    name = serializers.CharField(source='user.user.first_name', read_only=True)
    stock_class_name = serializers.CharField(source='stock_class.name', read_only=True)
    series_name = serializers.SerializerMethodField()
    vesting_start = serializers.DateField()
    vesting_end = serializers.DateField()
    cliff_months = serializers.SerializerMethodField()
    vesting_start = serializers.DateField(required=False, allow_null=True)
    vesting_end = serializers.DateField(required=False, allow_null=True)
    strike_price = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    purchase_price = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    vesting_frequency = serializers.ChoiceField(choices=EquityGrant.VESTING_FREQUENCIES)
    shares_per_period = serializers.SerializerMethodField()
    vested_shares = serializers.SerializerMethodField()
    unvested_shares = serializers.SerializerMethodField()
    vesting_period_months = serializers.SerializerMethodField()
    remaining_vesting_months = serializers.SerializerMethodField()
    vesting_status = serializers.SerializerMethodField()

    class Meta:
        model = EquityGrant
        fields = [
            'unique_id', 'name', 'stock_class_name', 'series_name',
            'num_shares', 'iso_shares', 'nqo_shares', 'rsu_shares',
            'common_shares', 'preferred_shares',
            'vesting_start', 'vesting_end', 'cliff_months',
            'strike_price', 'purchase_price', 'vesting_frequency', 'shares_per_period',
            'vested_shares', 'unvested_shares',
            'vesting_period_months', 'remaining_vesting_months', 'vesting_status',
        ]
        read_only_fields = [
            'unique_id', 'name', 'stock_class_name', 'series_name',
            'vested_shares', 'unvested_shares',
            'vesting_period_months', 'remaining_vesting_months',
            'vesting_status', 'cliff_months', 'shares_per_period',
        ]

    def get_series_name(self, obj):
        if obj.stock_class and obj.stock_class.series:
            return obj.stock_class.series.name
        return "N/A"

    def validate_stock_class(self, value):
        company = self.context['request'].user.profile.company
        if not StockClass.objects.filter(name=value, company=company).exists():
            raise serializers.ValidationError(
                f"Stock class '{value}' does not exist for your company."
            )
        return value

    def validate(self, attrs):
        iso = attrs.get('iso_shares', self.instance.iso_shares)
        nqo = attrs.get('nqo_shares', self.instance.nqo_shares)
        rsu = attrs.get('rsu_shares', self.instance.rsu_shares)
        common = attrs.get('common_shares', self.instance.common_shares)
        pref = attrs.get('preferred_shares', self.instance.preferred_shares)
        total = attrs.get('num_shares', self.instance.num_shares)
        if (iso + nqo + rsu + common + pref) != total:
            raise serializers.ValidationError(
                f"num_shares ({total}) must equal sum of share types ({iso + nqo + rsu + common + pref})."
            )
        if pref > 0 and (iso + nqo + rsu + common) > 0:
            raise serializers.ValidationError(
                "Cannot allocate ISO/NQO/RSU/Common shares when preferred_shares > 0."
            )
        return attrs

    def create(self, validated_data):
        class_name = validated_data.pop('stock_class')
        validated_data['stock_class'] = StockClass.objects.get(
            name=class_name,
            company=self.context['request'].user.profile.company
        )
        return super().create(validated_data)

    def update(self, instance, validated_data):
        class_name = validated_data.pop('stock_class', None)
        if class_name is not None:
            instance.stock_class = StockClass.objects.get(
                name=class_name,
                company=self.context['request'].user.profile.company
            )
        return super().update(instance, validated_data)

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
        freq = obj.vesting_frequency.lower()
        days = (obj.vesting_end - obj.vesting_start).days
        if freq == 'daily':    units = days
        elif freq == 'weekly': units = days // 7
        elif freq == 'biweekly': units = days // 14
        elif freq == 'yearly': units = rd.years
        else: units = rd.years * 12 + rd.months
        return obj.num_shares // units if units > 0 else 0

    def get_vested_shares(self, obj):
        if obj.preferred_shares > 0:
            return obj.preferred_shares
        return obj.vested_shares()

    def get_unvested_shares(self, obj):
        return obj.num_shares - self.get_vested_shares(obj)

    def get_vesting_period_months(self, obj):
        if not obj.vesting_start or not obj.vesting_end:
            return 0
        rd = relativedelta(obj.vesting_end, obj.vesting_start)
        return rd.years * 12 + rd.months

    def get_remaining_vesting_months(self, obj):
        today = timezone.now().date()
        if not obj.vesting_end:
            return 0
        rd = relativedelta(obj.vesting_end, today)
        return max(rd.years * 12 + rd.months, 0)

    def get_vesting_status(self, obj):
        if obj.preferred_shares > 0:
            return 'Preferred Shares (Immediate Vest)'
        vested = self.get_vested_shares(obj)
        total = obj.num_shares
        if vested == 0:
            return 'Not Vested'
        if vested >= total:
            return 'Fully Vested'
        return 'Vesting'

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