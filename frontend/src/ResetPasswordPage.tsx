import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { resetPassword } from "./auth";

export default function ResetPasswordPage() {
  const { uidb64, token } = useParams();
  const nav = useNavigate();

  // Must have both URL params (arrive via email link)
  const validParams = Boolean(uidb64 && token);

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [show1, setShow1] = useState(false);
  const [show2, setShow2] = useState(false);

  useEffect(() => {
    if (!validParams) {
      nav("/login", { replace: true });
    }
  }, [validParams, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    if (!pw1 || !pw2) return setErr("Please fill out both password fields.");
    if (pw1 !== pw2) return setErr("Passwords must match.");

    setErr(null);
    setLoading(true);
    try {
      await resetPassword(uidb64!, token!, pw1); // API expects { uidb64, token, new_password }
      nav("/login", { replace: true });
    } catch (error: any) {
      const msg =
        error?.response?.data?.detail ||
        error?.response?.data?.error ||
        "This reset link is invalid or has expired.";
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  if (!validParams) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 md:py-10 px-6 lg:px-10">
      <div className="w-full max-w-xl mx-auto mt-6 md:mt-10">
        <div className="bg-white rounded-2xl shadow-lg ring-1 ring-black/5 overflow-hidden">
          <div className="px-8 pt-6 pb-4 text-center">
            <h1 className="text-3xl font-semibold text-gray-900">Set a new password</h1>
            <p className="mt-1 text-sm text-gray-600">Enter and confirm your new password</p>
          </div>

          <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400" />

          <form onSubmit={submit} className="px-8 py-6 space-y-6">
            {err && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
                {err}
              </div>
            )}

            <div>
              <label htmlFor="pw1" className="block text-sm font-medium text-gray-700">
                New password
              </label>
              <div className="mt-1 relative">
                <input
                  id="pw1"
                  type={show1 ? "text" : "password"}
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  className="w-full h-12 rounded-lg border border-gray-300 px-3 pr-12 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShow1((v) => !v)}
                  className="absolute inset-y-0 right-2 my-auto text-xs px-2.5 py-1.5 rounded-md text-gray-600 hover:bg-gray-100"
                  aria-label={show1 ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {show1 ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="pw2" className="block text-sm font-medium text-gray-700">
                Confirm password
              </label>
              <div className="mt-1 relative">
                <input
                  id="pw2"
                  type={show2 ? "text" : "password"}
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  className="w-full h-12 rounded-lg border border-gray-300 px-3 pr-12 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShow2((v) => !v)}
                  className="absolute inset-y-0 right-2 my-auto text-xs px-2.5 py-1.5 rounded-md text-gray-600 hover:bg-gray-100"
                  aria-label={show2 ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {show2 ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full inline-flex items-center justify-center h-12 rounded-lg text-white text-[15px] transition ${
                loading
                  ? "bg-indigo-300 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              }`}
            >
              {loading ? "Resetting…" : "Reset password"}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-[11px] text-gray-500">
          You’ll be redirected to sign in after a successful reset.
        </p>
      </div>
    </div>
  );
}