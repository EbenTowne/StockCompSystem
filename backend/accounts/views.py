from django.urls import reverse
from django.core.mail import send_mail
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.exceptions import NotFound
from django.contrib.auth.models import User

from .models import UserProfile, EmployeeInvite
from .serializers import (
    EmployerRegistrationSerializer,
    EmployeeInviteSerializer,
    EmployeeRegistrationSerializer,
    EmployeeListSerializer
)
from .permissions import IsEmployer

class EmployerRegistrationView(generics.CreateAPIView):
    serializer_class   = EmployerRegistrationSerializer
    permission_classes = [permissions.AllowAny]

class EmployeeInviteView(generics.CreateAPIView):
    serializer_class   = EmployeeInviteSerializer
    permission_classes = [permissions.IsAuthenticated, IsEmployer]

    def perform_create(self, serializer):
        invite = serializer.save(
            company  = self.request.user.profile.company,
            employer = self.request.user
        )
        link = self.request.build_absolute_uri(
            reverse('register-employee-token', args=[str(invite.token)])
        )
        send_mail(
            subject        = "You’ve been invited!",
            message        = f"Register here: {link}",
            from_email     = None,
            recipient_list = [invite.email],
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(status=status.HTTP_201_CREATED)

class EmployeeRegistrationView(generics.GenericAPIView):
    serializer_class   = EmployeeRegistrationSerializer
    permission_classes = [permissions.AllowAny]

    def get_invite(self):
        token = self.kwargs.get('token')
        try:
            inv = EmployeeInvite.objects.get(token=token, is_used=False)
        except EmployeeInvite.DoesNotExist:
            raise NotFound("Invalid or expired invite token")
        return inv

    def post(self, request, token):
        invite = self.get_invite()
        ser    = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)

        user = User(
            username = ser.validated_data['name'],
            first_name = ser.validated_data['name'],
            email = invite.email
        )
        user.set_password(ser.validated_data['password'])
        user.save()

        profile = UserProfile.objects.create(
            user      = user,
            unique_id = ser.validated_data['unique_id'],
            role      = 'employee',
            company   = invite.company,
            employer  = invite.employer
        )

        invite.is_used = True
        invite.save()

        return Response({
            'unique_id': profile.unique_id,
            'name':      profile.user.first_name,
            'email':     profile.user.email,
        }, status=status.HTTP_201_CREATED)

class MyEmployeesListView(generics.ListAPIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    serializer_class   = EmployeeListSerializer

    def get_queryset(self):
        return UserProfile.objects.filter(employer=self.request.user)