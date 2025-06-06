from django.urls import path
from .views import EmployerRegistrationView, EmployeeRegistrationView

urlpatterns = [
    # Open Access: employer registers w/ company
    path('register/employer/', EmployerRegistrationView.as_view(), name='register-employer'),

    # Employers only: register an employee under that company
    path('register/employee/', EmployeeRegistrationView.as_view(), name='register-employee'),
]