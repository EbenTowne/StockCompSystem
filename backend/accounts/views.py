from rest_framework import generics, permissions, status
from rest_framework.response import Response
from .serializers import EmployerRegistrationSerializer, EmployeeRegistrationSerializer
from .models import UserProfile
from .permissions import IsEmployer

class EmployerRegistrationView(generics.CreateAPIView):
    """
    POST /api/register/employer/
    Public: Register a new employer (and their new Company).
    """
    serializer_class    = EmployerRegistrationSerializer
    permission_classes  = [permissions.AllowAny]


class EmployeeRegistrationView(generics.CreateAPIView):
    """
    POST /api/register/employee/
    Only an authenticated employer may register a new employee.
    """
    serializer_class    = EmployeeRegistrationSerializer
    permission_classes  = [permissions.IsAuthenticated, IsEmployer]

    def perform_create(self, serializer):
        # 1) serializer.save() returns a new User instance (but no profile yet)
        new_user = serializer.save()

        # 2) “employer_user” is the currently authenticated employer
        employer_user = self.request.user

        # 3) Create a UserProfile for the new user with role='employee'
        UserProfile.objects.create(
            user     = new_user,
            role     = 'employee',
            company  = employer_user.profile.company,
            employer = employer_user
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_201_CREATED)