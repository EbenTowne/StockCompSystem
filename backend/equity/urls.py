from django.urls import path
from .views import (
    BlackScholesCapTableView,
    MyGrantDetailView,
    MyGrantsView,
    SeriesDetailView,
    SeriesListCreateView,
    StockClassListCreateView,
    EquityGrantListCreateView,
    EmployeeGrantDetailView,
    CapTableView,
    GrantVestingScheduleView,
    AllGrantVestingScheduleView,
    EmployeeGrantDeleteView,
    StockClassDetailView,
    GrantIDListView,
    CompanyMonthlyExpensesView,
    GrantMonthlyExpensesView,
)

urlpatterns = [
    path('classes/', StockClassListCreateView.as_view(), name='stockclass-list'), #Set in: Company Metrics
    path('classes/<int:pk>/', StockClassDetailView.as_view(), name='stockclass-detail'), #View specfic class
    path('grants/', EquityGrantListCreateView.as_view(), name='equitygrant-list'), #Used to 
    path('grant-ids/<str:unique_id>/', GrantIDListView.as_view(), name='get-grant-ids'),
    path('cap-table/', CapTableView.as_view(), name='cap-table'),
    path('cap-table/bso/', BlackScholesCapTableView.as_view(), name='black-scholes-cap-table'),
    path('employees/<str:unique_id>/grants/', EmployeeGrantDeleteView.as_view(), name='grant-delete'),
    path('employees/<str:unique_id>/grants/<int:grant_id>/', EmployeeGrantDetailView.as_view(), name='grant-details'),
    path('employees/<str:unique_id>/grants/<int:grant_id>/schedule/', GrantVestingScheduleView.as_view(), name='grant-vesting-schedule'),
    path('employees/<str:unique_id>/grants/<int:grant_id>/monthly-expenses/', GrantMonthlyExpensesView.as_view(), name='grant-monthly-expenses'),
    path('expenses/', CompanyMonthlyExpensesView.as_view(), name='company-monthly-expenses'),
    path('schedule/all/', AllGrantVestingScheduleView.as_view(), name='combined-vesting-schedule'),
    path('series/', SeriesListCreateView.as_view(), name='series-list'),
    path('series/<int:pk>/', SeriesDetailView.as_view(), name='series-details'),
    path('me/grants/', MyGrantsView.as_view(), name='my-grants'),
    path('me/grants/<int:grant_id>/', MyGrantDetailView.as_view(), name='my-grant-detail'),
]