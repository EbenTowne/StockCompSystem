from django.urls import path
from .views import (
    DeleteAccountView,
    EmployerRegistrationView,
    EmployeeInviteView,
    EmployeeRegistrationView,
    MyEmployeesListView,
    DeleteAccountView,
    MyAccountInfoView,
    AllEmployersView,
    ForgotPasswordView, 
    ResetPasswordView, 
    ChangePasswordView
)

urlpatterns = [
    path('register/employer/', EmployerRegistrationView.as_view(), name='register-employer'),
    path('invite/employee/', EmployeeInviteView.as_view(), name='invite-employee'),
    path('register/employee/<uuid:token>/', EmployeeRegistrationView.as_view(),name='register-employee-token'),
    path('employees/', MyEmployeesListView.as_view(), name='my-employees'),
    path('deleteAccount/', DeleteAccountView.as_view(), name='delete-account'),
    path('accountInfo/', MyAccountInfoView.as_view(), name='account-info'),
    path('employers/', AllEmployersView.as_view(), name='all-employers'),
    path("auth/forgot-password/", ForgotPasswordView.as_view(), name="forgot-password"),
    path("auth/reset-password/",  ResetPasswordView.as_view(),  name="reset-password"),
    path("auth/change-password/", ChangePasswordView.as_view(), name="change-password"),
]