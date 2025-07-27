// frontend/src/ResetPasswordPage.tsx
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { resetPassword } from './auth';

export default function ResetPasswordPage() {
  const { uidb64 = '', token = '' } = useParams();
  const nav = useNavigate();

  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    // make sure both fields match
    if (pw1 !== pw2) {
      setErr('Passwords must match');
      return;
    }

    try {
      // pass both new_password and re_new_password
      await resetPassword(uidb64, token, pw1, pw2);
      nav('/login');
    } catch (err: any) {
      setErr(err.response?.data?.detail || 'Something went wrong');
    }
  };

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-2xl font-bold mb-6 text-center">Set a new password</h1>
      {err && <p className="text-red-500 mb-4">{err}</p>}
      <form onSubmit={submit} className="space-y-4">
        <input
          type="password"
          placeholder="New password"
          value={pw1}
          onChange={e => setPw1(e.target.value)}
          className="w-full p-2 border rounded"
        />
        <input
          type="password"
          placeholder="Confirm new password"
          value={pw2}
          onChange={e => setPw2(e.target.value)}
          className="w-full p-2 border rounded"
        />
        <button type="submit" className="w-full py-2 bg-blue-600 text-white rounded">
          Reset Password
        </button>
      </form>
    </div>
  );
}
