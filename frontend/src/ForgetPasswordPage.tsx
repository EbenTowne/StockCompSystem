import { useState } from 'react';
import { forgotPassword } from './auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent]   = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await forgotPassword(email);
    setSent(true);
  };

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-2xl font-bold mb-6 text-center">Forgot your password?</h1>
      {sent ? (
        <p className="text-green-600 text-center">If that e‑mail exists, a reset link has been sent.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <input className="input w-full" type="email" required placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} />
          <button className="btn-primary w-full" type="submit">Send reset link</button>
        </form>
      )}
    </div>
  );
}