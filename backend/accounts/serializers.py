from rest_framework import serializers
from django.contrib.auth.models import User
from .models import UserProfile, Company, EmployeeInvite
import uuid

class EmployerRegistrationSerializer(serializers.ModelSerializer):
    username     = serializers.CharField(
        write_only=True,
        required=True,
        error_messages={
            "required": "Username is required for employer registration.",
            "blank": "Username cannot be blank."
        }
    )
    name         = serializers.CharField(write_only=True)
    password     = serializers.CharField(write_only=True)
    company_name = serializers.CharField(write_only=True)
    unique_id    = serializers.CharField(write_only=True)

    class Meta:
        model  = User
        fields = ['username', 'name', 'password', 'email', 'company_name', 'unique_id']

    def create(self, validated_data):
        uid          = validated_data.pop('unique_id')
        company_name = validated_data.pop('company_name')
        name         = validated_data.pop('name')
        password     = validated_data.pop('password')
        username     = validated_data.pop('username')
        email        = validated_data.get('email', '')

        company_obj, _ = Company.objects.get_or_create(name=company_name)

        user = User(
            username   = username,
            first_name = name,
            email      = email
        )
        user.set_password(password)
        user.save()

        UserProfile.objects.create(
            user      = user,
            unique_id = uid,
            role      = 'employer',
            company   = company_obj
        )
        return user

    def to_representation(self, instance):
        profile = instance.profile
        return {
            'unique_id': profile.unique_id,
            'username':  instance.username,
            'name':      instance.first_name,
            'email':     instance.email,
            'role':      profile.role,
            'company':   profile.company.name,
        }

class EmployeeInviteSerializer(serializers.ModelSerializer):
    class Meta:
        model  = EmployeeInvite
        fields = ['email']

class EmployeeRegistrationSerializer(serializers.Serializer):
    username = serializers.CharField(
        required=True,
        error_messages={
            "required": "Username is required for employee registration.",
            "blank": "Username cannot be blank."
        }
    )
    name      = serializers.CharField()
    password  = serializers.CharField(write_only=True)
    unique_id = serializers.CharField()

class EmployeeListSerializer(serializers.ModelSerializer):
    unique_id = serializers.CharField(read_only=True)  # ✅ fixed from 'profile.unique_id'
    username  = serializers.CharField(source='user.username', read_only=True)
    name      = serializers.CharField(source='user.first_name', read_only=True)
    email     = serializers.EmailField(source='user.email', read_only=True)

    class Meta:
        model = UserProfile
        fields = ['unique_id', 'username', 'name', 'email']

class ProfileInfoSerializer(serializers.ModelSerializer):
    unique_id = serializers.CharField(read_only=True)
    name = serializers.CharField(source='user.first_name', read_only=True)
    email = serializers.CharField(source='user.email', read_only=True)
    company = serializers.CharField(source='company.name', read_only=True)
    role = serializers.CharField(read_only=True)

    class Meta:
        model = UserProfile
        fields = ['unique_id', 'name', 'email', 'company', 'role']

#USED FOR TESTING ONLY!!!!!
#DELETE WHEN DONE WITH ACCOUNT BACKEND!!!!
class EmployerListSerializer(serializers.ModelSerializer):
    unique_id = serializers.CharField(source='profile.unique_id', read_only=True)
    username  = serializers.CharField(read_only=True)
    name      = serializers.CharField(source='first_name', read_only=True)
    email     = serializers.EmailField(read_only=True)
    company   = serializers.CharField(source='profile.company.name', read_only=True)
    password  = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ['unique_id', 'username', 'name', 'email', 'company', 'password']