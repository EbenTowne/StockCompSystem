from django.db import models
from django.contrib.auth.models import User

class Company(models.Model):
    name = models.CharField(max_length=200, unique=True)
    def __str__(self):
        return self.name

class UserProfile(models.Model):
    ROLE_CHOICES = [
        ('employer', 'Employer'),
        ('employee', 'Employee')
    ]
    user     = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    role     = models.CharField(choices=ROLE_CHOICES, max_length=20)
    company  = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='users')
    employer = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='employees',
        null=True,
        blank=True
    )

    def __str__(self):
        if self.role == 'employer':
            return f"{self.user.username} (Employer of {self.company.name})"
        return f"{self.user.username} (Employee of {self.employer.username} at {self.company.name})"