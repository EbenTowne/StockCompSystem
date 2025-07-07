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
        fields = [
            'id', 'name', 'total_class_shares',
            'shares_allocated', 'shares_remaining'
        ]

    def validate_total_class_shares(self, value):
        request = self.context.get('request')
        company = request.user.profile.company
        others = company.stock_classes.exclude(pk=self.instance.pk) if self.instance else company.stock_classes.all()
        if sum(c.total_class_shares for c in others) + value > company.total_authorized_shares:
            raise serializers.ValidationError(
                f"Total across classes cannot exceed market cap ({company.total_authorized_shares})"
            )
        return value


class EquityGrantSerializer(serializers.ModelSerializer):
    user = serializers.CharField(write_only=True, required=False)
    stock_class = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = EquityGrant
        fields = [
            'id', 'user', 'stock_class',
            'num_shares', 'iso_shares', 'nso_shares', 'rsu_shares',
            'common_shares', 'preferred_shares',
            'strike_price', 'grant_date',
            'vesting_start', 'vesting_end', 'cliff_months',
        ]

    def validate(self, data):
        request = self.context['request']
        company = request.user.profile.company

        # On create or when explicitly provided, look up the user by unique_id
        if 'user' in data:
            uid = data.pop('user')
            try:
                user = UserProfile.objects.get(
                    unique_id=uid,
                    company=company,
                    role='employee'
                )
            except UserProfile.DoesNotExist:
                raise serializers.ValidationError({'user': f"Unknown employee ID {uid}"})
        else:
            # on update, keep existing
            user = self.instance.user

        # Same for stock_class
        if 'stock_class' in data:
            sc_name = data.pop('stock_class')
            try:
                sc = company.stock_classes.get(name=sc_name)
            except StockClass.DoesNotExist:
                raise serializers.ValidationError({'stock_class': f"Unknown class '{sc_name}'"})
        else:
            sc = self.instance.stock_class

        data['user'] = user
        data['stock_class'] = sc

        # breakdown sums
        total     = data.get('num_shares', self.instance.num_shares if self.instance else 0)
        iso       = data.get('iso_shares', getattr(self.instance, 'iso_shares', 0))
        nso       = data.get('nso_shares', getattr(self.instance, 'nso_shares', 0))
        rsu       = data.get('rsu_shares', getattr(self.instance, 'rsu_shares', 0))
        common    = data.get('common_shares', getattr(self.instance, 'common_shares', 0))
        preferred = data.get('preferred_shares', getattr(self.instance, 'preferred_shares', 0))

        if iso + nso + rsu + common + preferred != total:
            raise serializers.ValidationError({
                'num_shares': "ISO+NSO+RSU+Common+Preferred must equal total_shares"
            })

        # cannot mix preferred with any other
        if preferred and (iso or nso or rsu or common):
            raise serializers.ValidationError({
                'preferred_shares': "Preferred shares cannot mix with other types"
            })

        sp = data.get('strike_price', getattr(self.instance, 'strike_price', None))

        # 1) If any ISO/NSO/RSU/Common > 0, strike_price must be non-zero
        if (iso or nso or rsu or common):
            if sp is None or sp == 0:
                raise serializers.ValidationError({
                    'strike_price': "Must provide a non-zero strike price for ISO/NSO/RSU/Common shares"
                })

        # 2) If preferred > 0, strike_price must be exactly zero
        if preferred:
            if sp is None or sp != 0:
                raise serializers.ValidationError({
                    'strike_price': "Preferred shares must have strike_price = 0"
                })

        # class capacity check (unchanged)
        used = sc.shares_allocated - (self.instance.num_shares if self.instance else 0)
        if used + total > sc.total_class_shares:
            remaining = sc.total_class_shares - used
            raise serializers.ValidationError({
                'num_shares': f"Only {remaining} shares left in class"
            })

        # vesting cliff vs. period (unchanged)
        start = data.get('vesting_start', getattr(self.instance, 'vesting_start', None))
        end   = data.get('vesting_end', getattr(self.instance, 'vesting_end', None))
        cliff = data.get('cliff_months', getattr(self.instance, 'cliff_months', 0))
        if start and end:
            months = (end.year - start.year) * 12 + (end.month - start.month)
            if cliff > months:
                raise serializers.ValidationError({
                    'cliff_months': "Cliff cannot exceed vesting period"
                })

        return data


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
    ownership_pct            = serializers.FloatField()
    total_vesting_months     = serializers.IntegerField()
    remaining_vesting_months = serializers.IntegerField()
    cliff_months             = serializers.IntegerField()
    vesting_status           = serializers.CharField()
    strike_price             = serializers.DecimalField(
        max_digits=10, decimal_places=2, allow_null=True
    )

class EmployeeGrantDetailSerializer(serializers.ModelSerializer):
    unique_id                = serializers.CharField(source='user.unique_id')
    name                     = serializers.CharField(source='user.user.first_name')
    stock_class              = serializers.CharField(source='stock_class.name')
    iso                       = serializers.IntegerField(source='iso_shares')
    nso                       = serializers.IntegerField(source='nso_shares')
    rsu                       = serializers.IntegerField(source='rsu_shares')
    common_shares            = serializers.IntegerField()
    preferred_shares         = serializers.IntegerField()
    shares_allocated         = serializers.IntegerField(source='num_shares')
    vested_shares            = serializers.SerializerMethodField()
    unvested_shares          = serializers.SerializerMethodField()
    vesting_start            = serializers.DateField()
    vesting_end              = serializers.DateField()
    vesting_period_months     = serializers.SerializerMethodField()
    remaining_vesting_months = serializers.SerializerMethodField()
    cliff_months             = serializers.IntegerField()
    vesting_status           = serializers.SerializerMethodField()
    strike_price             = serializers.DecimalField(
        max_digits=10, decimal_places=2, allow_null=True
    )

    class Meta:
        model  = EquityGrant
        fields = [
            'unique_id','name','stock_class',
            'shares_allocated','iso','nso','rsu',
            'common_shares','preferred_shares',
            'vested_shares','unvested_shares',
            'vesting_start','vesting_end',
            'vesting_period_months','remaining_vesting_months',
            'cliff_months','vesting_status','strike_price',
        ]

    def get_vested_shares(self, obj):
        if obj.preferred_shares > 0:
            return obj.num_shares
        return obj.vested_shares()

    def get_unvested_shares(self, obj):
        return obj.num_shares - self.get_vested_shares(obj)

    def get_vesting_period_months(self, obj):
        rd = relativedelta(obj.vesting_end, obj.vesting_start)
        return rd.years * 12 + rd.months

    def get_remaining_vesting_months(self, obj):
        today = timezone.now().date()
        rd    = relativedelta(obj.vesting_end, today)
        return max(rd.years * 12 + rd.months, 0)

    def get_vesting_status(self, obj):
        if obj.preferred_shares > 0:
            return 'Preferred Shares (Immediate Vest)'
        vested = self.get_vested_shares(obj)
        total  = obj.num_shares
        if vested == 0:
            return 'Not Vested'
        if vested >= total:
            return 'Fully Vested'
        return 'Vesting'