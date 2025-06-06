from rest_framework import serializers
from django.contrib.auth.models import User
from .models import UserProfile, Company

class EmployerRegistrationSerializer(serializers.ModelSerializer):
    password      = serializers.CharField(write_only=True)
    company_name  = serializers.CharField(write_only=True)   # user sends in their company name

    class Meta:
        model  = User
        fields = ['id', 'username', 'password', 'email', 'company_name']
        read_only_fields = ['id']

    def create(self, validated_data):
        # 1) pull out the company_name
        company_name = validated_data.pop('company_name')

        # 2) create (or get) a Company row
        company_obj, created = Company.objects.get_or_create(name=company_name)

        # 3) create the User object
        user = User(
            username = validated_data['username'],
            email    = validated_data.get('email', '')
        )
        user.set_password(validated_data['password'])
        user.save()

        # 4) create the UserProfile with role='employer', no “employer” FK because it's an employer
        UserProfile.objects.create(
            user     = user,
            role     = 'employer',
            company  = company_obj,
            employer = None
        )

        return user

    def to_representation(self, instance):
        # Show back “role” / “company” to the client
        rep = super().to_representation(instance)
        profile = instance.profile
        rep['role']     = profile.role
        rep['employer'] = profile.employer.username if profile.employer else None
        rep['company']  = profile.company.name
        return rep


class EmployeeRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)

    class Meta:
        model  = User
        fields = ['id', 'username', 'password', 'email']
        read_only_fields = ['id']

    def to_representation(self, instance):
        rep = super().to_representation(instance)
        profile = instance.profile
        rep['role']     = profile.role
        rep['employer'] = profile.employer.username
        rep['company']  = profile.company.name
        return rep