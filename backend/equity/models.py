from django.db import models
from django.utils import timezone
from dateutil.relativedelta import relativedelta  # type: ignore
from accounts.models import Company, UserProfile

SHARE_TYPE_CHOICES = [
    ('COMMON', 'Common Stock'),
    ('PREFERRED', 'Preferred Stock'),
]

class Series(models.Model):
    company = models.ForeignKey(
        Company,
        on_delete=models.CASCADE,
        related_name='series'
    )
    name = models.CharField(max_length=255)
    share_type = models.CharField(max_length=100, choices=SHARE_TYPE_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name

class StockClass(models.Model):
    company = models.ForeignKey(
        'accounts.Company',
        on_delete=models.CASCADE,
        related_name='stock_classes'
    )
    name = models.CharField(max_length=100)
    total_class_shares = models.PositiveIntegerField()
    series = models.ForeignKey(
        Series,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='stock_classes'
    )

    def __str__(self):
        return f"{self.name}"

    @property
    def shares_allocated(self):
        return self.equity_grants.aggregate(
            total=models.Sum('num_shares')
        )['total'] or 0

    @property
    def shares_remaining(self):
        return self.total_class_shares - self.shares_allocated

class EquityGrant(models.Model):
    VESTING_FREQUENCIES = [
        ('DAILY',    'Daily'),
        ('WEEKLY',   'Weekly'),
        ('BIWEEKLY', 'Bi-weekly'),
        ('MONTHLY',  'Monthly'),
        ('YEARLY',   'Yearly'),
    ]

    user = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name='equity_grants'
    )
    stock_class = models.ForeignKey(
        StockClass,
        on_delete=models.CASCADE,
        related_name='equity_grants'
    )

    num_shares       = models.PositiveIntegerField()
    iso_shares       = models.PositiveIntegerField(default=0)
    nqo_shares       = models.PositiveIntegerField(default=0)
    rsu_shares       = models.PositiveIntegerField(default=0)
    common_shares    = models.PositiveIntegerField(default=0)
    preferred_shares = models.PositiveIntegerField(default=0)

    strike_price     = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    purchase_price   = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Used only for common or preferred shares purchased outright (not options)"
    )

    grant_date       = models.DateField(default=timezone.now)
    vesting_start    = models.DateField(null=True, blank=True)
    vesting_end      = models.DateField(null=True, blank=True)
    vesting_frequency = models.CharField(
        max_length=10,
        choices=VESTING_FREQUENCIES,
        default='MONTHLY'
    )
    cliff_months     = models.PositiveIntegerField(
        default=0,
        help_text="Full months since vesting_start (auto-calculated on save)"
    )

    total_expense             = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    annual_expense            = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    bso_value_per_option      = models.DecimalField(
        max_digits=12, decimal_places=6, null=True, blank=True
    )
    black_scholes_iso_expense = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )

    def __str__(self):
        return f"{self.user.unique_id}: {self.num_shares}@{self.stock_class.name}"

    def save(self, *args, **kwargs):
        if self.vesting_start:
            today = timezone.now().date()
            if today > self.vesting_start:
                rd = relativedelta(today, self.vesting_start)
                self.cliff_months = rd.years * 12 + rd.months
            else:
                self.cliff_months = 0
        super().save(*args, **kwargs)

    def vested_shares(self, on_date=None):
        on_date = on_date or timezone.now().date()

        if self.preferred_shares:
            return self.preferred_shares

        if not self.vesting_start or on_date < self.vesting_start:
            return 0

        if self.vesting_end and on_date >= self.vesting_end:
            return (
                self.iso_shares +
                self.nqo_shares +
                self.rsu_shares +
                self.common_shares
            )

        start = self.vesting_start
        end   = self.vesting_end
        elapsed = relativedelta(on_date, start)
        total   = relativedelta(end, start)
        elapsed_months = elapsed.years * 12 + elapsed.months
        total_months   = total.years   * 12 + total.months
        fraction = elapsed_months / total_months if total_months > 0 else 0

        vested_iso    = int(self.iso_shares    * fraction)
        vested_nqo    = int(self.nqo_shares    * fraction)
        vested_rsu    = int(self.rsu_shares    * fraction)
        vested_common = int(self.common_shares * fraction)

        return vested_iso + vested_nqo + vested_rsu + vested_common

    def vesting_schedule_breakdown(self):
        if self.preferred_shares and not (self.vesting_start and self.vesting_end):
            return [{
                'date':         self.grant_date.isoformat(),
                'iso':          0,
                'nqo':          0,
                'rsu':          0,
                'common':       0,
                'preferred':    self.preferred_shares,
                'total_vested': self.preferred_shares
            }]

        if not (self.vesting_start and self.vesting_end):
            return []

        start = self.vesting_start
        end   = self.vesting_end
        rd_total = relativedelta(end, start)
        total_months = rd_total.years * 12 + rd_total.months

        schedule = []
        prev = {'iso': 0, 'nqo': 0, 'rsu': 0, 'common': 0, 'preferred': 0}

        for m in range(1, total_months + 1):
            date_m = start + relativedelta(months=m)
            frac   = m / total_months

            cum_iso       = int(self.iso_shares    * frac)
            cum_nqo       = int(self.nqo_shares    * frac)
            cum_rsu       = int(self.rsu_shares    * frac)
            cum_common    = int(self.common_shares * frac)
            cum_preferred = self.preferred_shares if self.preferred_shares else 0

            vest = {
                'date':       date_m.isoformat(),
                'iso':        cum_iso - prev['iso'],
                'nqo':        cum_nqo - prev['nqo'],
                'rsu':        cum_rsu - prev['rsu'],
                'common':     cum_common - prev['common'],
                'preferred':  cum_preferred - prev['preferred'],
            }
            vest['total_vested'] = sum(vest[k] for k in ('iso','nqo','rsu','common','preferred'))

            schedule.append(vest)
            prev.update({
                'iso':       cum_iso,
                'nqo':       cum_nqo,
                'rsu':       cum_rsu,
                'common':    cum_common,
                'preferred': cum_preferred,
            })

        return schedule

    def get_vesting_status(self, on_date=None):
        if self.preferred_shares > 0:
            return 'Preferred Shares (Immediate Vest)'
        if self.common_shares > 0 and self.purchase_price:
            return 'Purchased Common (Immediate Vest)'
        vested = self.vested_shares(on_date)
        if vested == 0:
            return 'Not Vested'
        if vested >= self.num_shares:
            return 'Fully Vested'
        return 'Vesting'