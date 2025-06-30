import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { resetPassword } from './auth';   // ✅ fixed path

export default function ResetPasswordPage() {
  const { uidb64 = '', token = '' } = useParams();
  const nav = useNavigate();

  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw1 !== pw2) {
      setError('Passwords do not match');
      return;
    }
    try {
      await resetPassword(uidb64, token, pw1);
      nav('/login');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Something went wrong');
    }
  };

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-2xl font-bold mb-6 text-center">
        Set a new password
      </h1>

      <form onSubmit={submit} className="space-y-4">
        <input
          className="input w-full"
          type="password"
          required
          placeholder="New password"
          value={pw1}
          onChange={(e) => setPw1(e.target.value)}
        />
        <input
          className="input w-full"
          type="password"
          required
          placeholder="Confirm new password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
        />

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button className="btn-primary w-full" type="submit">
          Update password
        </button>
      </form>
    </div>
  );
}
