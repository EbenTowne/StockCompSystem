from rest_framework.test import APITestCase
from rest_framework import status
from django.urls import reverse

# Employer Registration
# Set up and pass/fail test cases
class Employer_Registration_Test(APITestCase):
    def setUp(self):
        self.api_url = reverse('register-employer')
        
    def test_employer_creation_pass(self):
        data = {'unique_id': '1234567890',
                'username': 'TestUser1',
                'name': 'Test McTest',
                'email': 'na@na.na',
                'company_name': 'The Testing Company',
                'password': 'password'}
        response = self.client.post(self.api_url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        #also need to check that the actual object exists
    
    def test_employer_creation_fail(self):
        data = {'name': 'Test Name'}
        response = self.client.post(self.api_url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

# Employer Login
# Set up and pass/fail test cases
class Employer_Login_Test(APITestCase):
    def setUp(self):
        self.api_url = reverse('my-employees')
        
        user_data = {'unique_id': '1234567890',
                'username': 'TestUser1',
                'name': 'Test McTest',
                'email': 'na@na.na',
                'company_name': 'The Testing Company',
                'password': 'password'}
        _ = self.client.post(reverse('register-employer'), user_data, format='json')
        
    def test_employer_login_pass(self):
        self.client.login(username='TestUser1', password='password')
        response = self.client.get(self.api_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
    
    def test_employer_login_fail(self):
        self.client.login(username='TestUser1', password='badpassword')
        response = self.client.get(self.api_url)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        
# Employee Invite
class Employee_Invite_Test(APITestCase):
    def setUp(self):
        self.api_url = reverse('invite-employee')
        
# Employer Registration
# Set up and pass/fail test cases
'''class Employer_Registration_Test(APITestCase):
    def setUp(self):
        self.api_url = reverse('register-employer')
        
    def test_employer_creation_pass(self):
        data = {'unique_id': '1234567890',
                'username': 'TestUser',
                'name': 'Test McTest',
                'email': 'na@na.na',
                'company_name': 'The Testing Company',
                'password': 'password'}
        response = self.client.post(self.api_url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        #also need to check that the actual object exists
    
    def test_employer_creation_fail(self):
        data = {'name': 'Test Name'}
        response = self.client.post(self.api_url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)'''