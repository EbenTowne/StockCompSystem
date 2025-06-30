import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { login } from './auth';       // ✅ fixed path

export default function LoginPage() {
  const nav = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPw] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      nav('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Login failed');
    }
  };

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-2xl font-bold mb-6 text-center">Sign in</h1>

      <form onSubmit={submit} className="space-y-4">
        <input
          className="input w-full"
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="input w-full"
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPw(e.target.value)}
        />

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button className="btn-primary w-full" type="submit">
          Login
        </button>
      </form>

      <div className="flex justify-between mt-4 text-sm">
        <Link
          to="/forgot-password"
          className="text-indigo-600 hover:underline"
        >
          Forgot password?
        </Link>
        <Link
          to="/register-employer"
          className="text-indigo-600 hover:underline"
        >
          Register as employer
        </Link>
      </div>
    </div>
  );
}
