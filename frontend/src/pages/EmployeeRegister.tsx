import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";

const API = import.meta.env.VITE_API_URL as string;

type InviteValidation = {
  email: string;
  company: string;
  company_id: number;
  inviter: string;
  expires_at: string | null;
};

function generateUniqueId(length = 12) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export default function EmployeeRegister() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const token = sp.get("token") ?? "";

  const [invite, setInvite] = useState<InviteValidation | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // No prepopulation now; users may keep it blank or enter their own.
  const [uniqueId, setUniqueId] = useState("");

  const canSubmit = useMemo(() => {
    return Boolean(
      username.trim() && name.trim() && password.length >= 8 && password === confirm && (uniqueId ?? "") !== undefined
    );
  }, [username, name, password, confirm, uniqueId]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setChecking(true);
      setError(null);
      try {
        if (!token) throw new Error("Missing invite token in the URL.");
        const url = `${API}/invite/employee/validate/?token=${encodeURIComponent(token)}`;
        const res = await axios.get<InviteValidation>(url);
        if (!cancelled) setInvite(res.data);
      } catch (e: any) {
        if (!cancelled) {
          const msg =
            e?.response?.data?.detail ||
            e?.response?.data ||
            e?.message ||
            "Invalid or expired invite token.";
          setError(typeof msg === "string" ? msg : "Invalid or expired invite token.");
          setInvite(null);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !token) return;
    setError(null);
    try {
      const url = `${API}/register/employee/${encodeURIComponent(token)}/`;
      await axios.post(url, {
        username: username.trim(),
        name: name.trim(),
        password,
        // send unique_id only if provided; backend can generate if omitted
        ...(uniqueId.trim() ? { unique_id: uniqueId.trim() } : {}),
      });
      nav("/login", { replace: true });
    } catch (e: any) {
      const d = e?.response?.data;
      if (!d) return setError("Registration failed.");
      if (typeof d === "string") return setError(d);
      if (d.error) return setError(String(d.error));
      if (d.detail) return setError(String(d.detail));
      const joined = Object.entries(d)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
        .join(" ");
      setError(joined || "Registration failed.");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 md:py-10 px-6 lg:px-10">
      <div className="w-full max-w-xl mx-auto mt-6 md:mt-10">
        <h1 className="sr-only">Endless Moments Stock Comp</h1>

        <div className="bg-white rounded-2xl shadow-lg ring-1 ring-black/5 overflow-hidden">
          {/* Header — mirrors Login */}
          <div className="px-8 pt-6 pb-4 text-center">
            <h2 className="text-3xl font-semibold text-gray-900">Join Company</h2>
            <p className="mt-1 text-sm text-gray-600">
              Create your employee account to get started.
            </p>
          </div>

          {/* Accent divider to match Login */}
          <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400" />

          <div className="px-8 py-6 space-y-6">
            {/* Status / Errors */}
            {checking ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 text-gray-700 text-sm px-3 py-2">
                Validating invite…
              </div>
            ) : error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
                {error}
              </div>
            ) : invite ? (
              <>
                {/* Invite details pill */}
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Invited by</span>
                    <span className="font-medium text-gray-900">{invite.inviter}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-gray-600">Company</span>
                    <span className="font-medium text-gray-900">{invite.company}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-gray-600">Invitation email</span>
                    <span className="font-medium text-gray-900">{invite.email}</span>
                  </div>
                </div>

                {/* Form — mirrors input sizing from Login */}
                <form onSubmit={onSubmit} className="space-y-6">
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
                      className="mt-1 w-full h-12 rounded-lg border border-gray-300 px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      aria-required
                    />
                  </div>

                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                      Full Name
                    </label>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      className="mt-1 w-full h-12 rounded-lg border border-gray-300 px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      aria-required
                    />
                  </div>

                  <div>
                    <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                      Password (min 8 chars)
                    </label>
                    <input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      className="mt-1 w-full h-12 rounded-lg border border-gray-300 px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={8}
                      aria-required
                    />
                  </div>

                  <div>
                    <label htmlFor="confirm" className="block text-sm font-medium text-gray-700">
                      Confirm Password
                    </label>
                    <input
                      id="confirm"
                      name="confirm"
                      type="password"
                      autoComplete="new-password"
                      className="mt-1 w-full h-12 rounded-lg border border-gray-300 px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      minLength={8}
                      aria-required
                    />
                    {confirm && password !== confirm && (
                      <p className="mt-1 text-xs text-red-600">Passwords do not match.</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="unique" className="block text-sm font-medium text-gray-700">
                      Employee ID (unique_id) <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="unique"
                        name="unique"
                        value={uniqueId}
                        onChange={(e) => setUniqueId(e.target.value.toUpperCase())}
                        className="mt-1 w-full h-12 rounded-lg border border-gray-300 px-3 text-[15px] tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Leave blank to auto-generate"
                      />
                      <button
                        type="button"
                        onClick={() => setUniqueId(generateUniqueId())}
                        className="mt-1 h-12 shrink-0 rounded-lg px-3 text-[13px] border border-gray-300 hover:bg-gray-50"
                        aria-label="Generate ID"
                      >
                        Generate
                      </button>
                    </div>
                    <p className="mt-1 text-[12px] text-gray-500">
                      You can enter your own ID or leave it blank to use an auto-generated one.
                    </p>
                  </div>

                  <button
                    type="submit"
                    className="w-full inline-flex items-center justify-center h-12 rounded-lg bg-indigo-600 text-white text-[15px] transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    Create Account
                  </button>
                </form>
              </>
            ) : null}
          </div>
        </div>

        <p className="mt-5 text-center text-[11px] text-gray-500">
          Your account will be linked to the inviting company.
        </p>
      </div>
    </div>
  );
}