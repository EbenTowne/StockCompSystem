from django.contrib import admin
from django.urls import path, include
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from accounts.views import LogoutView
from two_factor.urls import urlpatterns as two_factor_urlpatterns

urlpatterns = [
    path('admin/', admin.site.urls),

    # JWT auth
    path('api/token/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/logout/', LogoutView.as_view(), name='logout'),

    # Your apps
    path('api/', include('accounts.urls')),
    path('api/equity/', include('equity.urls')),

    # Browsable DRF auth
    path('api-auth/', include('rest_framework.urls')),
]
