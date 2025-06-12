from django.urls import path
from .views import (
    EmployerRegistrationView,
    EmployeeInviteView,
    EmployeeRegistrationView,
    MyEmployeesListView
)

urlpatterns = [
    path('register/employer/',               EmployerRegistrationView.as_view(),      name='register-employer'),
    path('invite/employee/',                 EmployeeInviteView.as_view(),            name='invite-employee'),
    path('register/employee/<uuid:token>/',  EmployeeRegistrationView.as_view(),      name='register-employee-token'),
    path('employees/',                       MyEmployeesListView.as_view(),           name='my-employees'),
]