import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { registerEmployer } from './auth';       // ✅ fixed path
import { v4 as uuidv4 } from 'uuid';

export default function RegisterEmployerPage() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    username: '',
    name:     '',
    email:    '',
    company:  '',
    password: '',
  });
  const [error, setError] = useState('');

  const handle =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await registerEmployer(
        form.username,
        form.name,
        form.email,
        form.password,
        form.company,
        uuidv4().slice(0, 12).toUpperCase(), // generate unique_id client-side
      );
      nav('/login');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Registration failed');
    }
  };

  return (
    <div className="mx-auto max-w-md py-16">
      <h1 className="text-2xl font-bold mb-6 text-center">
        Register as Employer
      </h1>

      <form onSubmit={submit} className="space-y-4">
        <input
          className="input w-full"
          placeholder="Username"
          required
          value={form.username}
          onChange={handle('username')}
        />
        <input
          className="input w-full"
          placeholder="Full name"
          required
          value={form.name}
          onChange={handle('name')}
        />
        <input
          className="input w-full"
          type="email"
          placeholder="Email"
          required
          value={form.email}
          onChange={handle('email')}
        />
        <input
          className="input w-full"
          placeholder="Company name"
          required
          value={form.company}
          onChange={handle('company')}
        />
        <input
          className="input w-full"
          type="password"
          placeholder="Password"
          required
          value={form.password}
          onChange={handle('password')}
        />

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button className="btn-primary w-full" type="submit">
          Create account
        </button>
      </form>

      <p className="text-center text-sm mt-4">
        Already have an account?{' '}
        <Link to="/login" className="text-indigo-600 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
