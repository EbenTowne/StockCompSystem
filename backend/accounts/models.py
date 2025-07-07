import uuid
import secrets
import string
from django.db import models
from django.contrib.auth.models import User

def generate_unique_id(length=12):
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))

class Company(models.Model):
    name = models.CharField(max_length=200, unique=True)
    total_authorized_shares = models.PositiveIntegerField(
        default=0,
        help_text="Total shares that this company can allocate"
    )
    current_fmv = models.DecimalField(
        max_digits = 12,
        decimal_places = 2,
        default = 0,
        help_text = "Current FMV per share (S)"
    )
    volatility = models.DecimalField(
        max_digits = 5,
        decimal_places = 2,
        default = 0,
        help_text = "Annualized volatility (Sigma)"
    )
    risk_free_rate = models.DecimalField(
        max_digits = 5,
        decimal_places = 4,
        default = 0,
        help_text = "Risk-free rate (r)"
    )

    def __str__(self):
        return self.name

class UserProfile(models.Model):
    unique_id = models.CharField(
        max_length=100,
        unique=False,
        editable=True,
        default=generate_unique_id
    )
    ROLE_CHOICES = [
        ('employer', 'Employer'),
        ('employee', 'Employee'),
    ]
    user     = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    role     = models.CharField(max_length=20, choices=ROLE_CHOICES)
    company  = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='users')
    employer = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='employees',
        null=True, blank=True
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['company', 'unique_id'],
                name='unique_company_unique_id'
            )
        ]

    def __str__(self):
        display = self.user.first_name or self.user.username
        if self.role == 'employer':
            return f"{display} (Employer of {self.company.name})"
        mgr = self.employer.first_name if self.employer else '—'
        return f"{display} (Employee of {mgr} at {self.company.name})"

class EmployeeInvite(models.Model):
    email      = models.EmailField()
    token      = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    company    = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='invites')
    employer   = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_invites')
    is_used    = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Invite {self.token} → {self.email}"