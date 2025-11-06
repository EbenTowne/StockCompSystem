import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { forgotPassword } from "./auth";

export default function ForgetPasswordPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setErr(null);

    const val = email.trim();
    if (!val) {
      setErr("Please enter an email address.");
      return;
    }

    setLoading(true);
    try {
      // Backend always returns a neutral success to avoid leaking accounts
      await forgotPassword(val);
      setSent(true);
    } catch (error: any) {
      // Still show the same neutral success UI to avoid account enumeration
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 md:py-10 px-6 lg:px-10">
      <div className="w-full max-w-xl mx-auto mt-6 md:mt-10">
        <div className="bg-white rounded-2xl shadow-lg ring-1 ring-black/5 overflow-hidden">
          <div className="px-8 pt-6 pb-4 text-center">
            <h1 className="text-3xl font-semibold text-gray-900">Forgot your password?</h1>
            <p className="mt-1 text-sm text-gray-600">
              Enter your email and we’ll send you a link to reset it.
            </p>
          </div>

          <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400" />

          <form onSubmit={submit} className="px-8 py-6 space-y-6">
            {err && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
                {err}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full h-12 rounded-lg border border-gray-300 px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="you@example.com"
                disabled={sent || loading}
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={sent || loading}
              className={`w-full inline-flex items-center justify-center h-12 rounded-lg text-white text-[15px] transition ${
                sent || loading
                  ? "bg-indigo-300 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              }`}
            >
              {loading ? "Sending…" : sent ? "Email sent" : "Send reset link"}
            </button>

            {sent && (
              <p className="text-sm text-gray-600 text-center">
                If that email exists, a reset link has been sent. Check your inbox and follow the
                link to continue.
              </p>
            )}

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => nav("/login")}
                className="text-sm text-indigo-600 hover:underline"
              >
                Back to sign in
              </button>
            </div>
          </form>
        </div>

        <p className="mt-5 text-center text-[11px] text-gray-500">
          We never reveal whether an account exists for privacy.
        </p>
      </div>
    </div>
  );
}