from datetime import date, timedelta
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

    @staticmethod
    def _units_between(start: date, end: date, freq: str) -> int:
        if end < start:
            return 0
        days = (end - start).days
        freq = (freq or "MONTHLY").upper()

        if freq == "DAILY":
            # inclusive: if start == end → 1 unit
            return days + 1
        if freq == "WEEKLY":
            return (days // 7) + 1
        if freq == "BIWEEKLY":
            return (days // 14) + 1
        if freq == "YEARLY":
            rd = relativedelta(end, start)
            # years is whole years elapsed; +1 to include the starting year unit
            return rd.years + 1
        # default MONTHLY
        rd = relativedelta(end, start)
        return (rd.years * 12 + rd.months) + 1
    
    def vested_shares(self, on_date: date | None = None) -> int:
        """
        Straight-line vesting by selected frequency from vesting_start to
        vesting_end (inclusive). Preferred shares vest immediately.
        """
        # Immediate vest for preferred
        if (self.preferred_shares or 0) > 0:
            return int(self.preferred_shares)

        # Need valid dates and total shares
        if not self.vesting_start or not self.vesting_end or not self.num_shares:
            return 0

        today = on_date or timezone.now().date()

        # Before vesting begins
        if today < self.vesting_start:
            return 0

        # Evaluate no later than the vesting_end
        eval_date = min(today, self.vesting_end)

        # Total/elapsed units by frequency (inclusive)
        total_units = self._units_between(self.vesting_start, self.vesting_end, self.vesting_frequency)
        elapsed_units = self._units_between(self.vesting_start, eval_date, self.vesting_frequency)

        if total_units <= 0:
            return 0

        # Straight-line allocation across the whole grant
        per_unit = self.num_shares / total_units
        vested = int(elapsed_units * per_unit)

        # Never exceed total shares
        return min(vested, int(self.num_shares))

    def vesting_schedule_breakdown(self):
        """
        Return a list of {date, iso, nqo, rsu, common, preferred, total_vested}
        entries, one per vesting period. Uses vesting_frequency and supports short
        grants (< 31 days) by switching to daily units.
        """

        # Immediate-vest cases
        if (self.preferred_shares or 0) > 0:
            total = int(self.preferred_shares or 0)
            return [{
                "date":        (self.grant_date or self.vesting_start or self.vesting_end).isoformat(),
                "iso":         0, "nqo": 0, "rsu": 0, "common": 0,
                "preferred":   total,
                "total_vested": total,
            }]
        if (self.common_shares or 0) > 0 and (self.purchase_price is not None):
            total = int(self.common_shares or 0)
            return [{
                "date":        (self.grant_date or self.vesting_start or self.vesting_end).isoformat(),
                "iso":         0, "nqo": 0, "rsu": 0,
                "common":      total, "preferred": 0,
                "total_vested": total,
            }]

        # Need both endpoints for a schedule
        if not (self.vesting_start and self.vesting_end):
            return []

        # Respect cliff (months)
        cliff_m = int(self.cliff_months or 0)
        start = self.vesting_start + relativedelta(months=+cliff_m)
        end   = self.vesting_end
        if start >= end:
            # vest everything at end if cliff reaches/passes end
            return [{
                "date":        end.isoformat(),
                "iso":         int(self.iso_shares or 0),
                "nqo":         int(self.nqo_shares or 0),
                "rsu":         int(self.rsu_shares or 0),
                "common":      int(self.common_shares or 0),
                "preferred":   0,
                "total_vested": int(self.iso_shares or 0) + int(self.nqo_shares or 0) +
                                int(self.rsu_shares or 0) + int(self.common_shares or 0),
            }]

        # Pick unit count + step based on frequency, with daily fallback for short spans
        freq = (self.vesting_frequency or "").lower()
        days_total = (end - start).days
        rd_total = relativedelta(end, start)

        if days_total < 31 or freq == "daily":
            units = max(days_total, 1)
            step  = timedelta(days=1)
        elif freq == "weekly":
            units = max(days_total // 7, 1)
            step  = timedelta(weeks=1)
        elif freq == "biweekly":
            units = max(days_total // 14, 1)
            step  = timedelta(days=14)
        elif freq == "yearly":
            units = max(rd_total.years, 1)
            step  = relativedelta(years=1)
        else:
            # default monthly
            units = max(rd_total.years * 12 + rd_total.months, 1)
            step  = relativedelta(months=1)

        def alloc_for_period(total, i, n):
            return int(total * i / n) - int(total * (i - 1) / n)

        iso_t   = int(self.iso_shares or 0)
        nqo_t   = int(self.nqo_shares or 0)
        rsu_t   = int(self.rsu_shares or 0)
        common_t= int(self.common_shares or 0)

        schedule = []
        for i in range(1, units + 1):
            d = start + (step * i if isinstance(step, timedelta) else relativedelta(start, start) + step * i)
            if d > end:
                d = end

            iso_p   = alloc_for_period(iso_t,    i, units)
            nqo_p   = alloc_for_period(nqo_t,    i, units)
            rsu_p   = alloc_for_period(rsu_t,    i, units)
            comm_p  = alloc_for_period(common_t, i, units)

            vest = {
                "date":       d.isoformat(),
                "iso":        iso_p,
                "nqo":        nqo_p,
                "rsu":        rsu_p,
                "common":     comm_p,
                "preferred":  0,
            }
            vest["total_vested"] = iso_p + nqo_p + rsu_p + comm_p
            schedule.append(vest)

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