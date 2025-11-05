import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { forgotPassword } from "./auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await forgotPassword(email); // keep logic
    setSent(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center py-16 px-6 lg:px-8">
      <div className="w-full max-w-xl lg:max-w-2xl">
        <div className="bg-white rounded-2xl shadow-lg ring-1 ring-black/5 overflow-hidden">
          <div className="px-10 py-8">
            <h1 className="text-center text-3xl font-semibold text-gray-900">
              Forgot Password
            </h1>
          </div>
          <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400" />

          <div className="px-10 py-8">
            {sent ? (
              <p className="text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-center">
                If that e-mail exists, a reset link has been sent.
              </p>
            ) : (
              <form onSubmit={submit} className="space-y-6">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full h-12 rounded-lg border border-gray-300 px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center h-12 rounded-lg text-white text-[15px] bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  Send reset link
                </button>
              </form>
            )}

            {/* NEW: Return to Sign in button (matches EmployerPage pattern) */}
            <div className="mt-6 text-center">
              <p className="text-sm text-gray-600">
                Ready to sign in?{" "}
                <button
                  type="button"
                  onClick={() => nav("/login")}
                  className="text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
                >
                  Click here
                </button>
              </p>
            </div>
          </div>
        </div>

        <p className="mt-5 text-center text-[11px] text-gray-500">
          We’ll email a link to reset your password if your address is on file.
        </p>
      </div>
    </div>
  );
}