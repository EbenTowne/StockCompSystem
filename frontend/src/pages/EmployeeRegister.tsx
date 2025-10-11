import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams, Link } from "react-router-dom";

const API =
  import.meta.env.VITE_API_URL ||
  `${window.location.origin.replace(":5173", ":8000")}/api`;

type ValidateResp = {
  email: string;
  company: string;
  company_id: number;
  inviter?: string;
  expires_at?: string | null;
};

export default function EmployeeRegister() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const token = sp.get("token") || "";

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<ValidateResp | null>(null);
  const [error, setError] = useState<string>("");

  // All fields intentionally empty by default (no prefill)
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [uniqueId, setUniqueId] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const expiresPretty = useMemo(() => {
    if (!invite?.expires_at) return null;
    const d = new Date(invite.expires_at);
    return isNaN(d.getTime()) ? null : d.toLocaleString();
  }, [invite]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setError("Missing invite token.");
        setLoading(false);
        return;
      }
      try {
        const { data } = await axios.get<ValidateResp>(
          `${API}/invite/employee/validate/`,
          { params: { token } }
        );
        if (cancelled) return;
        setInvite(data);
        // NOTE: no prefill of any fields here
      } catch (err: any) {
        if (cancelled) return;
        setError(
          err?.response?.data?.detail ||
          err?.response?.data?.error ||
          "This invite link is invalid or has expired."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!username.trim() || !name.trim() || !uniqueId.trim() || !password) {
      return setError("Please fill all fields.");
    }
    if (password !== confirm) {
      return setError("Passwords do not match.");
    }

    setSubmitting(true);
    try {
      await axios.post(
        `${API}/register/employee/${encodeURIComponent(token)}/`,
        { username, name, password, unique_id: uniqueId }
      );
      navigate("/login");
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.username ||
        err?.response?.data?.error ||
        "Could not complete registration.";
      setError(Array.isArray(msg) ? msg.join(" ") : String(msg));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-8">Loading…</div>;

  if (error)
    return (
      <main className="min-h-[60vh] grid place-items-center px-4">
        <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold">Invite Problem</h1>
          <p className="mt-3 text-red-600 text-sm">{error}</p>
          <div className="mt-6">
            <Link to="/login" className="text-sm underline">Go to login</Link>
          </div>
        </div>
      </main>
    );

  return (
    <main className="min-h-[60vh] grid place-items-center px-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Join {invite?.company}</h1>
        <p className="mt-1 text-sm text-gray-600">
          You’re registering <span className="font-medium">{invite?.email}</span>
          {expiresPretty ? <> · Link expires {expiresPretty}</> : null}
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Username</label>
            <input
              className="w-full rounded-xl border p-3 outline-none focus:ring-2"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Full name</label>
            <input
              className="w-full rounded-xl border p-3 outline-none focus:ring-2"
              placeholder="Jane Employee"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Unique ID</label>
            <input
              className="w-full rounded-xl border p-3 outline-none focus:ring-2"
              placeholder="Company-provided identifier"
              value={uniqueId}
              onChange={(e) => setUniqueId(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Password</label>
            <input
              type="password"
              className="w-full rounded-xl border p-3 outline-none focus:ring-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Confirm password</label>
            <input
              type="password"
              className="w-full rounded-xl border p-3 outline-none focus:ring-2"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-black p-3 text-white transition disabled:opacity-60"
          >
            {submitting ? "Creating account…" : "Create account"}
          </button>

          {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        </form>

        <div className="mt-6 text-center">
          <Link to="/login" className="text-sm underline">Back to login</Link>
        </div>
      </div>
    </main>
  );
}