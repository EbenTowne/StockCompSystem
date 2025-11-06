import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { registerEmployer } from "./auth";

// Match CompanyMetrics.tsx: read VITE_API_URL and set Axios base
const API = import.meta.env.VITE_API_URL as string; // e.g., "http://localhost:8000/api"
if (API) {
  axios.defaults.baseURL = API;
}

export default function RegisterEmployerPage() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    username: "",
    name: "",
    email: "",
    password: "",
    company_name: "",
    unique_id: "",
  });
  const [err, setErr] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErr("");

    try {
      // keep exact payload/logic
      await registerEmployer({
        username: form.username,
        name: form.name,
        email: form.email,
        password: form.password,
        company_name: form.company_name,
        unique_id: form.unique_id,
      });
      nav("/login");
    } catch (error: any) {
      const data = error?.response?.data;
      let message = "Registration failed";
      if (data && typeof data === "object") {
        if (data.username) {
          message = Array.isArray(data.username) ? data.username.join(" ") : String(data.username);
        } else if (data.email) {
          message = Array.isArray(data.email) ? data.email.join(" ") : String(data.email);
        } else if (data.detail) {
          message = String(data.detail);
        }
      }
      setErr(message);
    } finally {
      setIsLoading(false);
    }
  };

  const updateField =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [key]: e.target.value });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-16 px-6 lg:px-8 flex items-center justify-center">
      <div className="w-full max-w-xl lg:max-w-2xl">
        <div className="bg-white rounded-2xl shadow-lg ring-1 ring-black/5 overflow-hidden">
          <div className="px-10 py-8 text-center">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-blue-100 mb-4 text-blue-600 font-bold text-xl">
              E
            </div>
            <h1 className="text-3xl font-semibold text-gray-900">Register as Employer</h1>
            <p className="text-gray-600 mt-2">Create your employer account to get started</p>
          </div>
          <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400" />

          <div className="px-10 py-8">
            {err && (
              <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 text-sm">
                {err}
              </div>
            )}

            <form onSubmit={submit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Username</label>
                <input
                  type="text"
                  placeholder="Enter your username"
                  value={form.username}
                  onChange={updateField("username")}
                  className="mt-1 w-full h-12 rounded-lg border border-gray-300 px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Full Name</label>
                <input
                  type="text"
                  placeholder="Enter your full name"
                  value={form.name}
                  onChange={updateField("name")}
                  className="mt-1 w-full h-12 rounded-lg border border-gray-300 px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  placeholder="Enter your email"
                  value={form.email}
                  onChange={updateField("email")}
                  className="mt-1 w-full h-12 rounded-lg border border-gray-300 px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Password</label>
                <input
                  type="password"
                  placeholder="Create a secure password"
                  value={form.password}
                  onChange={updateField("password")}
                  className="mt-1 w-full h-12 rounded-lg border border-gray-300 px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Company Name</label>
                <input
                  type="text"
                  placeholder="Enter your company name"
                  value={form.company_name}
                  onChange={updateField("company_name")}
                  className="mt-1 w-full h-12 rounded-lg border border-gray-300 px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Unique ID</label>
                <input
                  type="text"
                  placeholder="Enter your unique identifier"
                  value={form.unique_id}
                  onChange={updateField("unique_id")}
                  className="mt-1 w-full h-12 rounded-lg border border-gray-300 px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className={`w-full inline-flex items-center justify-center h-12 rounded-lg text-white text-[15px] transition ${
                  isLoading
                    ? "bg-indigo-300 cursor-not-allowed"
                    : "bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                }`}
              >
                {isLoading ? (
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
                    Processing…
                  </span>
                ) : (
                  "Register"
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-gray-600">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => nav("/login")}
                  className="text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
                >
                  Sign in here
                </button>
              </p>
            </div>
          </div>
        </div>

        <p className="mt-5 text-center text-[11px] text-gray-500">
          Accounts are reviewed for compliance. By registering you agree to the Terms.
        </p>
      </div>
    </div>
  );
}