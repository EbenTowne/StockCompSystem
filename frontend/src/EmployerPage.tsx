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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // pass a single object to registerEmployer
      await registerEmployer({
        username: form.username,
        name: form.name,
        email: form.email,
        password: form.password,
        companyName: form.company_name,
        uniqueId: form.unique_id,
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
    }
  };

  const updateField = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-2xl font-bold mb-6 text-center">Register as Employer</h1>
      {err && <p className="text-red-500 mb-4">{err}</p>}
      <form onSubmit={submit} className="space-y-4">
        <input
          type="text"
          placeholder="Username"
          value={form.username}
          onChange={updateField('username')}
          className="w-full p-2 border rounded"
        />
        <input
          type="text"
          placeholder="Name"
          value={form.name}
          onChange={updateField('name')}
          className="w-full p-2 border rounded"
        />
        <input
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={updateField('email')}
          className="w-full p-2 border rounded"
        />
        <input
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={updateField('password')}
          className="w-full p-2 border rounded"
        />
        <input
          type="text"
          placeholder="Company Name"
          value={form.company_name}
          onChange={updateField('company_name')}
          className="w-full p-2 border rounded"
        />
        <input
          type="text"
          placeholder="Unique ID"
          value={form.unique_id}
          onChange={updateField('unique_id')}
          className="w-full p-2 border rounded"
        />
        <button type="submit" className="w-full py-2 bg-blue-600 text-white rounded">
          Register
        </button>
      </form>
    </div>
  );
}
