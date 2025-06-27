#Note: Views that contain post() are POST operations. Use POST method in frontend to properly call the api view.
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework import generics, permissions, status
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework.authentication import SessionAuthentication

from .models import UserProfile, EmployeeInvite
from .serializers import (
    EmployerRegistrationSerializer, 
    EmployeeInviteSerializer, 
    EmployeeRegistrationSerializer, 
    EmployeeListSerializer, 
    ProfileInfoSerializer
)
from .permissions import IsEmployer

from django.contrib.auth.models import User
from django.urls import reverse
from django.contrib.auth import logout as django_logout

#Import to implement blacklisting of tokens (logout function)
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken

#For email
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string



#View for employer registration
class EmployerRegistrationView(generics.CreateAPIView):
    serializer_class   = EmployerRegistrationSerializer
    permission_classes = [permissions.AllowAny] #Allow anyone to register as employer
    authentication_classes = []

#View for inviting employees to employer company
class EmployeeInviteView(generics.CreateAPIView):
    serializer_class   = EmployeeInviteSerializer
    permission_classes = [permissions.IsAuthenticated, IsEmployer] #Only employers can invite employees

    #Create invite email
    def perform_create(self, serializer):
        #Tie employer and company to invite
        invite = serializer.save(
            company  = self.request.user.profile.company,
            employer = self.request.user
        )

        #Create link to employee registration
        link = self.request.build_absolute_uri(
            reverse('register-employee-token', args=[str(invite.token)])
        )

        #Create email
        subject = f"You've been invited by {self.request.user.username}"
        
        #Open and read html content
        with open('accounts/templates/inviteEmail.html', 'r') as file:
            htmlContent = file.read()
        
        #Inject user specific content into html
        htmlContent = htmlContent.replace('{{ inviter }}', self.request.user.first_name or self.request.user.username)
        htmlContent = htmlContent.replace('{{ company }}', invite.company.name)
        htmlContent = htmlContent.replace('{{ link }}', link)

        textContent = f"You’ve been invited to join {invite.company.name} on Endless Moments.\nRegister here: {link}"

        email = EmailMultiAlternatives(
            subject = subject,
            body = textContent,
            from_email = None,
            to = [invite.email]
        )
        email.attach_alternative(htmlContent, "text/html")
        email.send()

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(status=status.HTTP_201_CREATED)

# View for registering employees
class EmployeeRegistrationView(generics.GenericAPIView):
    serializer_class = EmployeeRegistrationSerializer
    permission_classes = [permissions.AllowAny]  # Allow anyone with a valid token

    def get_invite(self):
        token = self.kwargs.get('token')
        try:
            inv = EmployeeInvite.objects.get(token=token, is_used=False)
        except EmployeeInvite.DoesNotExist:
            raise NotFound("Invalid or expired invite token")
        return inv

    def post(self, request, token):
        invite = self.get_invite()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Generate a unique username
        base_username = serializer.validated_data['name']
        username = base_username
        counter = 1
        while User.objects.filter(username=username).exists():
            username = f"{base_username} {counter}"
            counter += 1

        # Create the employee user
        user = User(
            username=username,
            first_name=serializer.validated_data['name'],
            email=invite.email
        )
        user.set_password(serializer.validated_data['password'])
        user.save()

        profile = UserProfile.objects.create(
            user=user,
            unique_id=serializer.validated_data['unique_id'],
            role='employee',
            company=invite.company,
            employer=invite.employer
        )

        invite.is_used = True
        invite.save()

        return Response(
            {
                'unique_id': profile.unique_id,
                'name': profile.user.first_name,
                'email': profile.user.email
            }, 
            status=status.HTTP_201_CREATED
        )

#View to show list of employees for an employer
class MyEmployeesListView(generics.ListAPIView):
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    serializer_class   = EmployeeListSerializer

    #Return list of employees tied to specified user
    def get_queryset(self):
        return UserProfile.objects.filter(employer=self.request.user)

#View to show user account info
class MyAccountInfoView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ProfileInfoSerializer

    def get(self, request):
        serializer = ProfileInfoSerializer(request.user.profile) 
        return Response(serializer.data)

#View to logout of account  
class LogoutView(APIView):
    authentication_classes = [JWTAuthentication, SessionAuthentication]
    permission_classes     = [IsAuthenticated]

    def post(self, request):
        #Blacklist (mark as used & prevent reuse) refresh JWT token
        for token in OutstandingToken.objects.filter(user=request.user):
            BlacklistedToken.objects.get_or_create(token=token)

        #If they were logged in via session (browsable API), log them out
        django_logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)
    
class DeleteAccountView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request):
        user = request.user
        profile = user.profile
        role = profile.role

        for token in OutstandingToken.objects.filter(user=user):
            BlacklistedToken.objects.get_or_create(token=token)
        django_logout(request)

        #If user is an employee, simply delete the account
        if role == 'employee':
            user.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        
        if role == 'employer':
            company = profile.company
            employees = UserProfile.objects.filter(company=company, role='employee')
            
            #delete each employee tied to employer's company
            for employee in employees:
                employee.user.delete()

            #delete company 
            company.delete()

            #delete employer
            user.delete()

            return Response(status=status.HTTP_204_NO_CONTENT)
        
        #Edge case for users without employer/employee role (shouldn't happen)
        return Response(
            {"detail": "Unrecognizable role, cannot delete"},
            status=status.HTTP_400_BAD_REQUEST
        )
        
