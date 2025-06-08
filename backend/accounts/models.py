import secrets
import string
from django.db import models
from django.contrib.auth.models import User

def generate_unique_id(length=12):
    #Generate a random alphanumeric string of given length.
    #Uses uppercase letters and digits.
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))

class Company(models.Model):
    name = models.CharField(max_length=200, unique=True)
    def __str__(self):
        return self.name

class UserProfile(models.Model):
    # 12-char alphanumeric unique ID
    unique_id = models.CharField(
        max_length=12,
        unique=True,
        editable=False,
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
        User,
        on_delete=models.CASCADE,
        related_name='employees',
        null=True,
        blank=True
    )

    def save(self, *args, **kwargs):
        # regenerate on collision
        if UserProfile.objects.filter(unique_id=self.unique_id).exclude(pk=self.pk).exists():
            self.unique_id = generate_unique_id()
            return self.save(*args, **kwargs)
        super().save(*args, **kwargs)

    def __str__(self):
        display = self.user.first_name or self.user.username
        if self.role == 'employer':
            return f"{display} (Employer of {self.company.name})"
        emp_name = self.employer.first_name if self.employer else '—'
        return f"{display} (Employee of {emp_name} at {self.company.name})"