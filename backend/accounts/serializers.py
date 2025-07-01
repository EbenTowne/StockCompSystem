"""
Serializers for the Accounts app
--------------------------------
Handles

  • Employer registration + listing
  • Employee invite / registration
  • Profile info
  • Forgot → Reset password flow
  • In-app Change password flow

All classes are imported by accounts.views, so keep their names.
"""

from django.contrib.auth.models import User
from rest_framework import serializers
from rest_framework.validators import UniqueValidator

from .models import UserProfile, Company, EmployeeInvite

# ────────────────────────────────
#  EMPLOYER  –  write + read
# ────────────────────────────────
class EmployerRegistrationSerializer(serializers.Serializer):
    unique_id     = serializers.CharField()
    username      = serializers.CharField(
        validators=[
            UniqueValidator(
                queryset=User.objects.all(),
                message="This username is already taken."
            )
        ]
    )
    name          = serializers.CharField()
    email         = serializers.EmailField(
        validators=[
            UniqueValidator(
                queryset=User.objects.all(),
                message="This email is already registered."
            )
        ]
    )
    company_name  = serializers.CharField()
    password      = serializers.CharField(write_only=True, min_length=8)

    def create(self, validated):
        company, _ = Company.objects.get_or_create(name=validated["company_name"])
        user = User.objects.create_user(
            username   = validated["username"],
            first_name = validated["name"],
            email      = validated["email"],
            password   = validated["password"],
        )
        UserProfile.objects.create(
            user      = user,
            unique_id = validated["unique_id"],
            role      = "employer",
            company   = company,
        )
        return user

    def to_representation(self, instance):
        prof = instance.profile
        return {
            "unique_id": prof.unique_id,
            "username":  instance.username,
            "name":      instance.first_name,
            "email":     instance.email,
            "company":   prof.company.name,
            "role":      prof.role,
        }


class EmployerListSerializer(serializers.ModelSerializer):
    """Read-only rows shown on Employer listing endpoints"""

    username = serializers.CharField(source="user.username", read_only=True)
    name     = serializers.CharField(source="user.first_name", read_only=True)
    email    = serializers.EmailField(source="user.email", read_only=True)
    company  = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model  = UserProfile
        fields = ["unique_id", "username", "name", "email", "company", "role"]


# ────────────────────────────────
#  FORGOT / RESET / CHANGE  password
# ────────────────────────────────
class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()


class ResetPasswordSerializer(serializers.Serializer):
    uidb64       = serializers.CharField()
    token        = serializers.CharField()
    new_password = serializers.CharField(min_length=8)


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_old_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Current password is not correct")
        return value

    def save(self, **kwargs):
        user = self.context["request"].user
        user.set_password(self.validated_data["new_password"])
        user.save()
        return user


# ────────────────────────────────
#  EMPLOYEE invite / registration / listing
# ────────────────────────────────
class EmployeeInviteSerializer(serializers.ModelSerializer):
    class Meta:
        model  = EmployeeInvite
        fields = ["email"]


class EmployeeRegistrationSerializer(serializers.Serializer):
    username  = serializers.CharField()
    name      = serializers.CharField()
    password  = serializers.CharField(write_only=True, min_length=8)
    unique_id = serializers.CharField()


class EmployeeListSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    name     = serializers.CharField(source="user.first_name", read_only=True)
    email    = serializers.EmailField(source="user.email", read_only=True)

    class Meta:
        model  = UserProfile
        fields = ["unique_id", "username", "name", "email"]


# ────────────────────────────────
#  PROFILE info (common to both roles)
# ────────────────────────────────
class ProfileInfoSerializer(serializers.ModelSerializer):
    name    = serializers.CharField(source="user.first_name", read_only=True)
    email   = serializers.EmailField(source="user.email", read_only=True)
    company = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model  = UserProfile
        fields = ["unique_id", "name", "email", "company", "role"]
