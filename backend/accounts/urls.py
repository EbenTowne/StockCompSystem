from django.urls import path
from .views import EmployerRegistrationView, EmployeeRegistrationView, MyEmployeesListView

urlpatterns = [
    path('register/employer/', EmployerRegistrationView.as_view(), name='register-employer'),
    path('register/employee/', EmployeeRegistrationView.as_view(), name='register-employee'),
    path('employees/',            MyEmployeesListView.as_view(),       name='my-employees'),
]