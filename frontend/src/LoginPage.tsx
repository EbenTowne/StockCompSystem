import { useState, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { getAccountInfo } from './auth';
import { AuthContext } from './context/AuthContext'; // use the existing context (no changes to the file)

export default function LoginPage() {
  const nav = useNavigate();
  const { signIn } = useContext(AuthContext)!; // signIn comes from your original AuthContext
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      // 1) Use context signIn so AuthContext.user is set (ProtectedRoute will allow entry)
      await signIn(username, password);  // tokens saved as accessToken/refreshToken in your context

      // 2) Configure axios using the token your context stored
      const access = localStorage.getItem('accessToken'); // matches your AuthContext storage
      if (access) {
        axios.defaults.headers.common['Authorization'] = `Bearer ${access}`;
      }

      // 3) Fetch account info to decide destination (employee vs employer)
      try {
        const acct = await getAccountInfo(access || '');
        const role: string =
          (acct.data?.role as string) ??
          (acct.data?.is_employer ? 'employer' : 'employee');

        nav(role === 'employee' ? '/employee/dashboard' : '/dashboard');
      } catch {
        // If /accountInfo/ fails, default to employer dashboard
        nav('/dashboard');
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Login failed');
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