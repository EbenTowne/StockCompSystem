from rest_framework import generics, permissions, status
from rest_framework.response import Response
from .serializers import EmployerRegistrationSerializer, EmployeeRegistrationSerializer, EmployeeListSerializer
from .models import UserProfile
from .permissions import IsEmployer

class EmployerRegistrationView(generics.CreateAPIView):
    serializer_class   = EmployerRegistrationSerializer
    permission_classes = [permissions.AllowAny]

class EmployeeRegistrationView(generics.CreateAPIView):
    serializer_class   = EmployeeRegistrationSerializer
    permission_classes = [permissions.IsAuthenticated, IsEmployer]

    def perform_create(self, serializer):
        new_user = serializer.save()
        UserProfile.objects.create(
            user     = new_user,
            role     = 'employee',
            company  = self.request.user.profile.company,
            employer = self.request.user
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

class MyEmployeesListView(generics.ListAPIView):
    #GET to url: /api/employees/
    #Only employers see their employees’ 12-char alphanumeric unique_ids.
    permission_classes = [permissions.IsAuthenticated, IsEmployer]
    serializer_class   = EmployeeListSerializer

    def get_queryset(self):
        return UserProfile.objects.filter(employer=self.request.user)