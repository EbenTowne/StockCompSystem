import math
from django.utils import timezone
from django.db.models import Sum
from rest_framework import serializers
from dateutil.relativedelta import relativedelta # type: ignore
from accounts.models import UserProfile
from .models         import StockClass, EquityGrant

class StockClassSerializer(serializers.ModelSerializer):
    shares_allocated = serializers.IntegerField(read_only=True)
    shares_remaining = serializers.IntegerField(read_only=True)

    class Meta:
        model = StockClass
        fields = ['id', 'name', 'total_class_shares', 'shares_allocated', 'shares_remaining']

    def validate_total_class_shares(self, value):
        request = self.context['request']
        company = request.user.profile.company
        others = company.stock_classes.exclude(pk=self.instance.pk) if self.instance else company.stock_classes.all()
        if sum(c.total_class_shares for c in others) + value > company.total_authorized_shares:
            raise serializers.ValidationError(f"Total across classes cannot exceed market cap ({company.total_authorized_shares})")
        return value

class EquityGrantSerializer(serializers.ModelSerializer):
    user              = serializers.CharField(write_only=True, required=False)
    stock_class       = serializers.CharField(write_only=True, required=False)
    vesting_frequency = serializers.ChoiceField(
        choices=EquityGrant.VESTING_FREQUENCIES,
        default='MONTHLY'
    )
    # ← 1) Make sure this line is here, with the other fields:
    cliff_months      = serializers.SerializerMethodField()
    shares_per_period = serializers.SerializerMethodField()

    class Meta:
        model  = EquityGrant
        fields = [
            'id', 'user', 'stock_class',
            'num_shares', 'iso_shares', 'nqo_shares', 'rsu_shares',
            'common_shares', 'preferred_shares',
            'strike_price', 'grant_date',
            'vesting_start', 'vesting_end',
            'cliff_months',             # ← included in the output
            'vesting_frequency', 'shares_per_period',
        ]

    def validate(self, data):
        company = self.context['request'].user.profile.company
        if 'user' in data:
            uid = data.pop('user')
            user = UserProfile.objects.filter(unique_id=uid, company=company, role='employee').first()
            if not user:
                raise serializers.ValidationError({'user': f"Unknown employee ID {uid}"})
        else:
            user = self.instance.user
        if 'stock_class' in data:
            name = data.pop('stock_class')
            sc = company.stock_classes.filter(name=name).first()
            if not sc:
                raise serializers.ValidationError({'stock_class': f"Unknown class '{name}'"})
        else:
            sc = self.instance.stock_class
        data['user'] = user
        data['stock_class'] = sc

        total = data.get('num_shares', getattr(self.instance, 'num_shares', 0))
        iso = data.get('iso_shares', getattr(self.instance, 'iso_shares', 0))
        nqo = data.get('nqo_shares', getattr(self.instance, 'nqo_shares', 0))
        rsu = data.get('rsu_shares', getattr(self.instance, 'rsu_shares', 0))
        common = data.get('common_shares', getattr(self.instance, 'common_shares', 0))
        pref = data.get('preferred_shares', getattr(self.instance, 'preferred_shares', 0))

        if iso + nqo + rsu + common + pref != total:
            raise serializers.ValidationError({'num_shares': "ISO+NQO+RSU+Common+Preferred must equal total_shares"})
        if pref and (iso or nqo or rsu or common):
            raise serializers.ValidationError({'preferred_shares': "Preferred shares cannot mix with other types"})

        sp = data.get('strike_price', getattr(self.instance, 'strike_price', None))
        if (iso or nqo or rsu or common) and not sp:
            raise serializers.ValidationError({'strike_price': "Must provide a non-zero strike price for ISO/NQO/RSU/Common shares"})
        if pref and sp != 0:
            raise serializers.ValidationError({'strike_price': "Preferred shares must have strike_price = 0"})

        used = sc.shares_allocated - (self.instance.num_shares if self.instance else 0)
        if used + total > sc.total_class_shares:
            rem = sc.total_class_shares - used
            raise serializers.ValidationError({'num_shares': f"Only {rem} shares left in class"})

        start = data.get('vesting_start', getattr(self.instance, 'vesting_start', None))
        end = data.get('vesting_end', getattr(self.instance, 'vesting_end', None))
        cliff = getattr(self.instance, 'cliff_months', 0)
        if start and end:
            months = (end.year - start.year) * 12 + (end.month - start.month)
            if cliff > months:
                raise serializers.ValidationError({'cliff_months': "Cliff cannot exceed vesting period"})

        return data
    
    def get_cliff_months(self, obj):
        today = timezone.now().date()
        if not obj.vesting_start:
            return 0
        if obj.vesting_start > today:
            rd = relativedelta(obj.vesting_start, today)
        else:
            rd = relativedelta(today, obj.vesting_start)

        return rd.years * 12 + rd.months

    def get_shares_per_period(self, obj):
        rd = relativedelta(obj.vesting_end, obj.vesting_start)
        freq = obj.vesting_frequency.lower()
        if freq == 'daily':
            units = (obj.vesting_end - obj.vesting_start).days
        elif freq == 'weekly':
            units = (obj.vesting_end - obj.vesting_start).days // 7
        elif freq == 'biweekly':
            units = (obj.vesting_end - obj.vesting_start).days // 14
        elif freq == 'yearly':
            units = rd.years
        else:
            units = rd.years * 12 + rd.months
        if units <= 0 or obj.num_shares == 0:
            return 0
        return obj.num_shares // units

class CapTableSerializer(serializers.Serializer):
    unique_id                = serializers.CharField()
    name                     = serializers.CharField()
    stock_class              = serializers.CharField()
    isos                     = serializers.IntegerField()
    nqos                     = serializers.IntegerField()
    rsus                     = serializers.IntegerField()
    common_shares            = serializers.IntegerField()
    preferred_shares         = serializers.IntegerField()
    total_shares             = serializers.IntegerField()
    strike_price             = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    ownership_pct            = serializers.FloatField()
    vesting_start            = serializers.DateField()               # ← add this
    vesting_end              = serializers.DateField()               # ← add this
    cliff_months             = serializers.SerializerMethodField()
    total_vesting_months     = serializers.IntegerField()
    remaining_vesting_months = serializers.IntegerField()
    vesting_status           = serializers.CharField()

    #Obtain the number of cliff months
    def get_cliff_months(self, obj):
        start = obj.get('vesting_start')
        if not start:
            return 0
        today = timezone.now().date()
        if start > today:
            rd = relativedelta(start, today)
        else:
            rd = relativedelta(today, start)
        return rd.years * 12 + rd.months

class EmployeeGrantDetailSerializer(serializers.ModelSerializer):
    unique_id = serializers.CharField(source='user.unique_id', read_only=True)
    name = serializers.CharField(source='user.user.first_name', read_only=True)
    stock_class = serializers.CharField()
    vesting_start = serializers.DateField()
    vesting_end = serializers.DateField()
    cliff_months = serializers.SerializerMethodField()
    strike_price = serializers.DecimalField(max_digits=10, decimal_places=2)
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
            'unique_id', 'name', 'stock_class',
            'num_shares', 'iso_shares', 'nqo_shares', 'rsu_shares',
            'common_shares', 'preferred_shares',
            'vesting_start', 'vesting_end', 'cliff_months',
            'strike_price', 'vesting_frequency', 'shares_per_period',
            'vested_shares', 'unvested_shares',
            'vesting_period_months', 'remaining_vesting_months', 'vesting_status',
        ]
        read_only_fields = [
            'unique_id', 'name',
            'vested_shares', 'unvested_shares',
            'vesting_period_months', 'remaining_vesting_months',
            'vesting_status', 'cliff_months', 'shares_per_period',
        ]

    #Ensure the stock class listed is valid
    def validate_stock_class(self, value):
        company = self.context['request'].user.profile.company
        if not StockClass.objects.filter(name=value, company=company).exists():
            raise serializers.ValidationError(f"Stock class '{value}' does not exist for your company.")
        return value

    #Perform edge case checking to ensure grant follows specified parameters
    def validate(self, attrs):
        def get_val(field):
            if field in attrs:
                return attrs[field]
            return getattr(self.instance, field) if self.instance else None

        iso = get_val('iso_shares')
        nqo = get_val('nqo_shares')
        rsu = get_val('rsu_shares')
        common = get_val('common_shares')
        preferred = get_val('preferred_shares')
        total = get_val('num_shares')

        if (iso + nqo + rsu + common + preferred) != total:
            raise serializers.ValidationError(
                f"num_shares ({total}) must equal sum of share types ({iso + nqo + rsu + common + preferred})."
            )
        if preferred > 0 and (iso + nqo + rsu + common) > 0:
            raise serializers.ValidationError(
                "Cannot allocate ISO/NQO/RSU/Common shares when preferred_shares > 0."
            )
        return attrs

    #Create detailed notes for grant
    def create(self, validated_data):
        class_name = validated_data.pop('stock_class')
        validated_data['stock_class'] = StockClass.objects.get(
            name=class_name,
            company=self.context['request'].user.profile.company
        )
        return super().create(validated_data)

    #Update Grant Details
    def update(self, instance, validated_data):
        class_name = validated_data.pop('stock_class', None)
        if class_name is not None:
            instance.stock_class = StockClass.objects.get(
                name=class_name,
                company=self.context['request'].user.profile.company
            )
        return super().update(instance, validated_data)

    #Obtain the number of cliff months
    def get_cliff_months(self, obj):
        today = timezone.now().date()
        if not obj.vesting_start:
            return 0
        if obj.vesting_start > today:
            rd = relativedelta(obj.vesting_start, today)
        else:
            rd = relativedelta(today, obj.vesting_start)

        return rd.years * 12 + rd.months

    #Obtain the number of shares that are vested per vesting period
    def get_shares_per_period(self, obj):
        rd = relativedelta(obj.vesting_end, obj.vesting_start)
        freq = obj.vesting_frequency.lower()
        if freq == 'daily':
            units = (obj.vesting_end - obj.vesting_start).days
        elif freq == 'weekly':
            units = (obj.vesting_end - obj.vesting_start).days // 7
        elif freq == 'biweekly':
            units = (obj.vesting_end - obj.vesting_start).days // 14
        elif freq == 'yearly':
            units = rd.years
        else:
            units = rd.years * 12 + rd.months
        if units <= 0 or obj.num_shares == 0:
            return 0
        return obj.num_shares // units

    #Obtain the number of currently vested shares
    def get_vested_shares(self, obj):
        if obj.preferred_shares > 0:
            return obj.num_shares
        return obj.vested_shares()

    #Get the number of currently unvested shares
    def get_unvested_shares(self, obj):
        return obj.num_shares - self.get_vested_shares(obj)

    #Get the total number of months within vesting schedule
    def get_vesting_period_months(self, obj):
        rd = relativedelta(obj.vesting_end, obj.vesting_start)
        return rd.years * 12 + rd.months

    #Get the number of months till vesting completion
    def get_remaining_vesting_months(self, obj):
        today = timezone.now().date()
        rd = relativedelta(obj.vesting_end, today)
        return max(rd.years * 12 + rd.months, 0)

    #Obtain the current vesting status
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
  
def _normal_cdf(x: float) -> float:
    return (1.0 + math.erf(x / math.sqrt(2.0))) / 2.0

#Perform Black Scholes to get the BSO price per share
def bs_call_price(S: float, K: float, T: float, r: float, sigma: float) -> float:
    #Company FMV Value (Current market price per share)
    S = float(S)
    #Set strike price for grant
    K = float(K)

    #If the underlying price is zero, option is worthless
    if S <= 0:
        return 0.0
    #If strike is zero or negative, you simply get the full stock price today
    if K <= 0:
        return S
    #If time to expiry is zero or negative, it's just intrinsic value
    if T <= 0:
        return max(0.0, S - K)
    #If volatility is zero, price = discounted intrinsic at zero vol
    if sigma <= 0:
        return max(0.0, S - K * math.exp(-r * T))

    #Black Scholes calculations
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    return S * _normal_cdf(d1) - K * math.exp(-r * T) * _normal_cdf(d2)


class BlackScholesCapTableSerializer(serializers.Serializer):
    #Standard Cap Table Fields
    unique_id                 = serializers.CharField()
    name                      = serializers.CharField()
    stock_class               = serializers.CharField()
    isos                      = serializers.IntegerField()
    nqos                      = serializers.IntegerField()
    rsus                      = serializers.IntegerField()
    common_shares             = serializers.IntegerField()
    preferred_shares          = serializers.IntegerField()
    total_shares              = serializers.IntegerField()
    strike_price              = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    ownership_pct             = serializers.FloatField()
    cliff_months              = serializers.SerializerMethodField()
    total_vesting_months      = serializers.IntegerField()
    remaining_vesting_months  = serializers.IntegerField()
    vesting_status            = serializers.CharField()

    #Black Scholes Values
    current_share_price = serializers.FloatField()
    risk_free_rate      = serializers.FloatField()
    volatility          = serializers.FloatField()
    bso_value_per_option      = serializers.SerializerMethodField()
    total_expense             = serializers.SerializerMethodField()
    annual_expense            = serializers.SerializerMethodField()
    black_scholes_iso_expense = serializers.SerializerMethodField()

    #Get information tied to the specific grant
    def get_grant(self, obj) -> EquityGrant:
        grant = obj.get('grant_obj')
        if not isinstance(grant, EquityGrant):
            raise serializers.ValidationError("Missing EquityGrant instance")
        return grant

    #Get the number of cliff months
    def get_cliff_months(self, obj) -> int:
        grant = self.get_grant(obj)
        start = grant.vesting_start
        if not start:
            return 0
        today = timezone.now().date()
        if start > today:
            date = relativedelta(start, today)
        else:
            date = relativedelta(today, start)
        return date.years * 12 + date.months

    #Get the black scholes value per options (iso and nqo shares)
    def get_bso_value_per_option(self, obj) -> float:
        S = obj['current_share_price']
        K = float(self.get_grant(obj).strike_price or 0)
        today    = timezone.now().date()
        end      = self.get_grant(obj).vesting_end or today
        T_years  = max((end - today).days, 0) / 365.0
        r        = obj['risk_free_rate']
        sigma    = obj['volatility']
        return round(bs_call_price(S, K, T_years, r, sigma), 6)

    #Get the total expense for the share allocations (bso_value * (iso shares + nqo shares)) + (current_set_share_price * (rsu shares + common shares + preferred shares))
    def get_total_expense(self, obj) -> float:
        iso_nqo = self.get_black_scholes_iso_expense(obj)
        grant   = self.get_grant(obj)
        cp      = obj['current_share_price']
        rsu     = grant.rsu_shares
        common  = grant.common_shares
        pref    = grant.preferred_shares
        other   = (rsu + common + pref) * cp
        return round(iso_nqo + other, 2)

    #Get annual expenses (total expenses / number of years)
    def get_annual_expense(self, obj) -> float:
        total = self.get_total_expense(obj)
        grant = self.get_grant(obj)
        vs, ve = grant.vesting_start, grant.vesting_end
        if not (vs and ve and ve > vs):
            return round(total, 2)

        #Compute total vesting months
        rd = relativedelta(ve, vs)
        total_months = rd.years * 12 + rd.months
        if total_months <= 0:
            return round(total, 2)

        years = total_months / 12
        return round(total / years, 2)

    #Compute black scholes expenses (bso_value * (iso shares + nqo shares))
    def get_black_scholes_iso_expense(self, obj) -> float:
        grant = self.get_grant(obj)
        bso   = self.get_bso_value_per_option(obj)
        return round((grant.iso_shares + grant.nqo_shares) * bso, 2)