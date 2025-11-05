import { useState, useContext, useEffect } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import axios from "axios";
import { getAccountInfo } from "./auth";
import { AuthContext } from "./context/AuthContext";

const API = import.meta.env.VITE_API_URL as string | undefined;

export default function LoginPage() {
  const nav = useNavigate();
  const location = useLocation();
  const { signIn } = useContext(AuthContext)!;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (API) axios.defaults.baseURL = API;
    document.title = "EndlessMoments: Stock Based Compensation";
  }, []);

  const search = new URLSearchParams(location.search);
  const next = search.get("next");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    const u = username.trim();
    const p = password;

    if (!u || !p) {
      setError("Please enter your username and password.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await signIn(u, p);

      const access = localStorage.getItem("accessToken");
      if (access) {
        axios.defaults.headers.common["Authorization"] = `Bearer ${access}`;
      }

      let dest = next && next.startsWith("/") ? next : null;

      if (!dest) {
        try {
          const acct = await getAccountInfo(access || "");
          const role: string =
            (acct?.data?.role as string) ??
            (acct?.data?.is_employer ? "employer" : "employee");
          dest = role === "employee" ? "/employee/dashboard" : "/dashboard";
        } catch {
          dest = "/dashboard";
        }
      }

      nav(dest!, { replace: true });
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        "Invalid credentials. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center py-16 px-6 lg:px-8">
      {/* Wider responsive container so it fits large screens better */}
      <div className="w-full max-w-xl lg:max-w-2xl">
        <h1 className="sr-only">Endless Moments Stock Comp</h1>

        <div className="bg-white rounded-2xl shadow-lg ring-1 ring-black/5 overflow-hidden">
          <div className="px-10 py-8">
            <h2 className="text-center text-3xl font-semibold text-gray-900">Sign in</h2>
          </div>
          <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400" />

          <form onSubmit={handleSubmit} className="px-10 py-8 space-y-6">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700">
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                inputMode="text"
                autoComplete="username"
                placeholder="yourname"
                className="mt-1 w-full h-12 rounded-lg border border-gray-300 px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                autoFocus
                aria-required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="mt-1 relative">
                <input
                  id="password"
                  name="password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full h-12 rounded-lg border border-gray-300 px-3 pr-12 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  aria-required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 right-2 my-auto text-xs px-2.5 py-1.5 rounded-md text-gray-600 hover:bg-gray-100"
                  aria-label={showPw ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`w-full inline-flex items-center justify-center h-12 rounded-lg text-white text-[15px] transition ${
                loading
                  ? "bg-indigo-300 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              }`}
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" className="opacity-25" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                  Signing in…
                </span>
              ) : (
                "Login"
              )}
            </button>

            <div className="flex items-center justify-between text-sm pt-1">
              <Link to="/forgot-password" className="text-indigo-600 hover:underline">
                Forgot password?
              </Link>
              <Link to="/register-employer" className="text-indigo-600 hover:underline">
                Register as employer
              </Link>
            </div>
          </form>
        </div>

        <p className="mt-5 text-center text-[11px] text-gray-500">
          Protected by role-based access. By signing in you agree to the Terms.
        </p>
      </div>
    </div>
  );
}