from django.db import models
from django.utils import timezone
from dateutil.relativedelta import relativedelta # type: ignore
from accounts.models import Company, UserProfile

class StockClass(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='stock_classes')
    name = models.CharField(max_length=100)
    total_class_shares = models.PositiveIntegerField(default=0, help_text="Shares this class may issue")
    class Meta:
        unique_together = [['company','name']]
    def __str__(self):
        return f"{self.company.name} – {self.name}"
    @property
    def shares_allocated(self):
        return sum(g.num_shares for g in self.equitygrant_set.all())
    @property
    def shares_remaining(self):
        return self.total_class_shares - self.shares_allocated

class EquityGrant(models.Model):
    user = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='equity_grants')
    stock_class= models.ForeignKey(StockClass, on_delete=models.PROTECT)
    num_shares = models.PositiveIntegerField(help_text="Total shares allocated")
    iso_shares = models.PositiveIntegerField(default=0, help_text="ISO share count")
    nso_shares = models.PositiveIntegerField(default=0, help_text="NSO share count")
    rsu_shares = models.PositiveIntegerField(default=0, help_text="RSU share count")
    common_shares    = models.PositiveIntegerField(default=0)
    preferred_shares = models.PositiveIntegerField(default=0)
    strike_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    grant_date = models.DateField(default=timezone.now)
    vesting_start = models.DateField(null=True, blank=True)
    vesting_end = models.DateField(null=True, blank=True)
    cliff_months = models.PositiveIntegerField(default=0, help_text="Months until first vest (cliff)")
    total_expense = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    annual_expense = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    bso_value_per_option = models.DecimalField(max_digits=12, decimal_places=6, null=True, blank=True)
    black_scholes_iso_expense = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    def __str__(self):
        return f"{self.user.unique_id}: {self.num_shares}@{self.stock_class.name}"

    def vested_shares(self, on_date=None):
        on_date = on_date or timezone.now().date()

        # No schedule = fully vested
        if not self.vesting_start or not self.vesting_end:
            return self.num_shares

        # Before vesting starts = 0 vested
        if on_date < self.vesting_start:
            return 0

        # After vesting ends = fully vested
        if on_date >= self.vesting_end:
            return self.num_shares

        # Compute full months elapsed
        elapsed_months = relativedelta(on_date, self.vesting_start).months + \
            (relativedelta(on_date, self.vesting_start).years * 12) # type: ignore

        # Compute total months in vesting period
        total_months = relativedelta(self.vesting_end, self.vesting_start).months + \
            (relativedelta(self.vesting_end, self.vesting_start).years * 12) # type: ignore

        # Calculate vested shares
        return int((self.num_shares * elapsed_months) / total_months)
