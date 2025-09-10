# accounts/api.py

from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework.response import Response
from rest_framework import status
from django_otp.plugins.otp_totp.models import TOTPDevice

class OTPTokenObtainPairView(TokenObtainPairView):
    # explicitly set the serializer here
    serializer_class = TokenObtainPairSerializer

    def post(self, request, *args, **kwargs):
        # 1) validate credentials through the parent
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # 2) get the user from the serializer
        user = serializer.user

        # 3) check OTP
        otp_code = request.data.get('otp', '')
        device = TOTPDevice.objects.filter(user=user, confirmed=True).first()
        if not device or not device.verify_token(otp_code):
            return Response({'detail': 'Invalid OTP'}, status=status.HTTP_401_UNAUTHORIZED)

        # 4) return the normal token-pair response
        return Response(serializer.validated_data, status=status.HTTP_200_OK)
