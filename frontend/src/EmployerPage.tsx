// frontend/src/EmployerPage.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { registerEmployer } from './auth';

export default function RegisterEmployerPage() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    username: '',
    name: '',
    email: '',
    password: '',
    company_name: '',
    unique_id: '',
  });
  const [err, setErr] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErr('');
    
    try {
      // pass a single object to registerEmployer
      await registerEmployer({
        username: form.username,
        name: form.name,
        email: form.email,
        password: form.password,
        company_name: form.company_name,
        unique_id: form.unique_id,
      });
      nav('/login');
    } catch (err: any) {
      const data = err.response?.data;
      let message = 'Registration failed';
      if (data && typeof data === 'object') {
        // prefer username or email errors
        if (data.username) {
          message = Array.isArray(data.username)
            ? data.username.join(' ')
            : String(data.username);
        } else if (data.email) {
          message = Array.isArray(data.email)
            ? data.email.join(' ')
            : String(data.email);
        }
      }
      setErr(message);
    } finally {
      setIsLoading(false);
    }
  };

  const updateField = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4 flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg overflow-hidden">
        <div className="px-8 py-10">
          <div className="text-center mb-8">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-blue-100 mb-4 text-blue-600 font-bold text-xl">
              E
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Register as Employer</h1>
            <p className="text-gray-600 mt-2">Create your employer account to get started</p>
          </div>

          {err && (
            <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded">
              <p className="text-red-700 font-medium">{err}</p>
            </div>
          )}

          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="block text-gray-700 text-sm font-bold mb-2">Username</label>
              <input
                type="text"
                placeholder="Enter your username"
                value={form.username}
                onChange={updateField('username')}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                required
              />
            </div>

            <div>
              <label className="block text-gray-700 text-sm font-bold mb-2">Full Name</label>
              <input
                type="text"
                placeholder="Enter your full name"
                value={form.name}
                onChange={updateField('name')}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                required
              />
            </div>

            <div>
              <label className="block text-gray-700 text-sm font-bold mb-2">Email</label>
              <input
                type="email"
                placeholder="Enter your email"
                value={form.email}
                onChange={updateField('email')}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                required
              />
            </div>

            <div>
              <label className="block text-gray-700 text-sm font-bold mb-2">Password</label>
              <input
                type="password"
                placeholder="Create a secure password"
                value={form.password}
                onChange={updateField('password')}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                required
              />
            </div>

            <div>
              <label className="block text-gray-700 text-sm font-bold mb-2">Company Name</label>
              <input
                type="text"
                placeholder="Enter your company name"
                value={form.company_name}
                onChange={updateField('company_name')}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                required
              />
            </div>

            <div>
              <label className="block text-gray-700 text-sm font-bold mb-2">Unique ID</label>
              <input
                type="text"
                placeholder="Enter your unique identifier"
                value={form.unique_id}
                onChange={updateField('unique_id')}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg transition duration-200 ${
                isLoading ? 'opacity-75 cursor-not-allowed' : 'hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500'
              }`}
            >
              {isLoading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </span>
              ) : (
                'Register'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Already have an account?{' '}
              <button 
                onClick={() => nav('/login')} 
                className="text-blue-600 hover:text-blue-800 font-medium transition-colors"
              >
                Sign in here
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}