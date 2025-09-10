# accounts/utils.py
from django.contrib.auth.tokens import default_token_generator
from django.utils.http import urlsafe_base64_encode
from django.utils.encoding import force_bytes
from django.core.mail import send_mail
from django.urls import reverse
from django.conf import settings
from django.contrib.auth.models import User

def send_verification_email(request, user: User):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    verify_url = request.build_absolute_uri(
        reverse('verify-email', kwargs={'uidb64': uid, 'token': token})
    )
    send_mail(
        subject='Verify your email',
        message=f'Click the link to verify your email: {verify_url}',
        from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', None),
        recipient_list=[user.email],
    )
