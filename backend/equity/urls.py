from django.urls import path
from .views import (
    StockClassListCreateView,
    EquityGrantListCreateView,
    EmployeeGrantDetailView,
    CapTableView,
    GrantVestingScheduleView,
    AllGrantVestingScheduleView,
    EmployeeGrantDeleteView,
    StockClassDetailView
)

urlpatterns = [
    path('classes/', StockClassListCreateView.as_view(), name='stockclass-list'),
    path('classes/<int:pk>/', StockClassDetailView.as_view(), name='stockclass-detail'),
    path('grants/', EquityGrantListCreateView.as_view(), name='equitygrant-list'),
    path('cap-table/', CapTableView.as_view(), name='cap-table'),
    path('employees/<str:unique_id>/grants/<int:grant_id>/', EmployeeGrantDetailView.as_view(), name='employee-grant-detail'),
    path('employees/<str:unique_id>/grants/<int:grant_id>/schedule/', GrantVestingScheduleView.as_view(), name='grant-vesting-schedule'),
    path('schedule/all/', AllGrantVestingScheduleView.as_view(), name='all-vesting-schedule'),
    path('employees/<str:unique_id>/grants/', EmployeeGrantDeleteView.as_view(), name='employee-grants-delete'),
]