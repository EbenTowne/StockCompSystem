// src/LoginPage.tsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { login } from './auth';

export default function LoginPage() {
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      // 1) call login() and pull out the tokens
      const { data } = await login(username, password);

      // 2) store them however you like
      localStorage.setItem('access_token', data.access);
      localStorage.setItem('refresh_token', data.refresh);

      // 3) configure axios for all future calls
      axios.defaults.headers.common['Authorization'] = `Bearer ${data.access}`;

      // 4) redirect on success
      nav('/dashboard');
    } catch (err: any) {
      // show the message from DRF or a fallback
      setError(err.response?.data?.detail || 'Login failed');
    }
  };

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-2xl font-bold mb-6 text-center">Sign in</h1>

      <form onSubmit={submit} className="space-y-4">
        <input
          className="input w-full"
          type="text"
          placeholder="Username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        <input
          className="input w-full"
          type="password"
          placeholder="Password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button className="btn-primary w-full" type="submit">
          Login
        </button>
      </form>

      <div className="flex justify-between mt-4 text-sm">
        <Link to="/forgot-password" className="text-indigo-600 hover:underline">
          Forgot password?
        </Link>
        <Link to="/register-employer" className="text-indigo-600 hover:underline">
          Register as employer
        </Link>
      </div>
    </div>
  );
}
