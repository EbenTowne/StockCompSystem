from rest_framework import serializers
from django.contrib.auth.models import User
from .models import UserProfile, Company, EmployeeInvite

class EmployerRegistrationSerializer(serializers.ModelSerializer):
    name         = serializers.CharField(write_only=True)
    password     = serializers.CharField(write_only=True)
    company_name = serializers.CharField(write_only=True)
    unique_id    = serializers.CharField(write_only=True)

    class Meta:
        model  = User
        fields = ['name', 'password', 'email', 'company_name', 'unique_id']

    def create(self, validated_data):
        uid          = validated_data.pop('unique_id')
        company_name = validated_data.pop('company_name')
        name         = validated_data.pop('name')
        company_obj, _ = Company.objects.get_or_create(name=company_name)

        user = User(
            username   = name,
            first_name = name,
            email      = validated_data.get('email', '')
        )
        user.set_password(validated_data['password'])
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
    name      = serializers.CharField()
    password  = serializers.CharField(write_only=True)
    unique_id = serializers.CharField()

class EmployeeListSerializer(serializers.ModelSerializer):
    unique_id = serializers.CharField(source='profile.unique_id', read_only=True)
    name      = serializers.CharField(source='user.first_name', read_only=True)
    email     = serializers.EmailField(source='user.email', read_only=True)

    class Meta:
        model  = UserProfile
        fields = ['unique_id', 'name', 'email']

class ProfileInfoSerializer(serializers.ModelSerializer):
    unique_id = serializers.CharField(read_only=True)
    name = serializers.CharField(source='user.first_name', read_only=True)
    email = serializers.CharField(source='user.email', read_only=True)
    company = serializers.CharField(source='company.name', read_only=True)
    role = serializers.CharField(read_only=True)

    class Meta:
        model = UserProfile
        fields = ['unique_id', 'name', 'email', 'company', 'role']