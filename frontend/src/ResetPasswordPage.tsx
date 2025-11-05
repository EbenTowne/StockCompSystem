import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { resetPassword } from "./auth";

export default function ResetPasswordPage() {
  const { uidb64 = "", token = "" } = useParams();
  const nav = useNavigate();

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (pw1 !== pw2) {
      setErr("Passwords must match");
      return;
    }

    try {
      await resetPassword(uidb64, token, pw1, pw2); // keep logic
      nav("/login");
    } catch (error: any) {
      setErr(error?.response?.data?.detail || "Something went wrong");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center py-16 px-6 lg:px-8">
      <div className="w-full max-w-lg">
        <div className="bg-white rounded-2xl shadow-lg ring-1 ring-black/5 overflow-hidden">
          <div className="px-8 py-7">
            <h1 className="text-center text-2xl font-semibold text-gray-900">Set a new password</h1>
          </div>
          {/* Slightly thicker accent than Forgot so each page feels unique */}
          <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400" />

          <form onSubmit={submit} className="px-8 py-7 space-y-5">
            {err && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
                {err}
              </div>
            )}

            <div>
              <label htmlFor="pw1" className="block text-sm font-medium text-gray-700">New password</label>
              <input
                id="pw1"
                type="password"
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
                className="mt-1 w-full h-11 rounded-lg border border-gray-300 px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="pw2" className="block text-sm font-medium text-gray-700">Confirm password</label>
              <input
                id="pw2"
                type="password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                className="mt-1 w-full h-11 rounded-lg border border-gray-300 px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center h-11 rounded-lg text-white text-[15px] bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              Reset password
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11px] text-gray-500">
          You’ll be redirected to sign in after a successful reset.
        </p>
      </div>
    </div>
  );
}