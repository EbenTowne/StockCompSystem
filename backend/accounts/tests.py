import uuid
from django.urls import reverse
from django.contrib.auth.models import User
from django.core import mail
from rest_framework.test import APITestCase, APIClient
from rest_framework import status

from .models import Company, UserProfile, EmployeeInvite

class EmployeeInviteFlowTests(APITestCase):
    def setUp(self):
        # 1) Create an employer user and profile
        self.employer_user = User.objects.create_user(
            username='alice',
            password='TopSecret123',
            email='alice@acme.com'
        )
        self.company = Company.objects.create(name='Acme Corp')
        self.employer_profile = UserProfile.objects.create(
            user=self.employer_user,
            unique_id='ACME-001',
            role='employer',
            company=self.company
        )

        # 2) Prepare an authenticated client as that employer
        self.client = APIClient()
        self.client.force_authenticate(user=self.employer_user)

    def test_invite_requires_auth(self):
        # Unauthenticated clients may not send invites
        self.client.force_authenticate(user=None)
        resp = self.client.post('/api/invite/employee/', {'email': 'joe@example.com'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_send_invite_and_email(self):
        # Authenticated employer sends invite
        resp = self.client.post('/api/invite/employee/', {'email': 'jane.doe@example.com'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

        # Check model
        invite = EmployeeInvite.objects.get(email='jane.doe@example.com', employer=self.employer_user)
        self.assertFalse(invite.is_used)
        self.assertEqual(invite.company, self.company)

        # Check that exactly one email was sent
        self.assertEqual(len(mail.outbox), 1)
        email = mail.outbox[0]
        # The body should contain the tokenized URL
        self.assertIn(str(invite.token), email.body)

    def test_employee_registration_with_valid_invite(self):
        # Create a new invite manually
        invite = EmployeeInvite.objects.create(
            email=self.employer_user.email,  # re-use
            company=self.company,
            employer=self.employer_user
        )

        # Registration endpoint is public (token grants authority)
        self.client.force_authenticate(user=None)
        data = {
            'name': 'Jane Doe',
            'password': 'pass1234',
            'unique_id': '123-45-6789'
        }
        url = f'/api/register/employee/{invite.token}/'
        resp = self.client.post(url, data, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

        # Invite is marked used
        invite.refresh_from_db()
        self.assertTrue(invite.is_used)

        # New user + profile created correctly
        new_user = User.objects.get(username='Jane Doe')
        profile = new_user.profile
        self.assertEqual(profile.role, 'employee')
        self.assertEqual(profile.company, self.company)
        self.assertEqual(profile.employer, self.employer_user)
        self.assertEqual(profile.unique_id, '123-45-6789')

    def test_cannot_reuse_invite(self):
        invite = EmployeeInvite.objects.create(
            email='jane@example.com',
            company=self.company,
            employer=self.employer_user,
            is_used=True
        )
        self.client.force_authenticate(user=None)
        data = {'name': 'Jane', 'password': 'pwd', 'unique_id': 'ID'}
        url = f'/api/register/employee/{invite.token}/'
        resp = self.client.post(url, data, format='json')
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_invalid_token_returns_404(self):
        self.client.force_authenticate(user=None)
        fake_token = uuid.uuid4()
        resp = self.client.post(f'/api/register/employee/{fake_token}/',
                                {'name':'X','password':'Y','unique_id':'Z'},
                                format='json')
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_list_employees_shows_registered(self):
        # Register one employee
        invite = EmployeeInvite.objects.create(
            email='jane@example.com',
            company=self.company,
            employer=self.employer_user
        )
        self.client.force_authenticate(user=None)
        self.client.post(
            f'/api/register/employee/{invite.token}/',
            {'name':'Jane','password':'pwd','unique_id':'ID1'},
            format='json'
        )
        # Now list as employer
        self.client.force_authenticate(user=self.employer_user)
        resp = self.client.get('/api/employees/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.json()
        # We expect at least one entry matching our registration
        self.assertTrue(
            any(emp['unique_id']=='ID1' and emp['email']=='jane@example.com' for emp in data)
        )