import React, { useEffect, useState } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL; // → "http://localhost:8000/api"

export default function InviteEmployee() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const access = localStorage.getItem("accessToken");
    if (access) axios.defaults.headers.common["Authorization"] = `Bearer ${access}`;
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    if (!email.trim()) return setNote({ type: "err", text: "Please enter an email." });

    setLoading(true);
    try {
      await axios.post(`${API}/invite/employee/`, { email });
      setEmail("");
      setNote({ type: "ok", text: "Invite sent. Check the employee’s inbox." });
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.response?.data?.error || "Failed to send invite.";
      setNote({ type: "err", text: msg });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-[60vh] grid place-items-center px-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Invite Employee</h1>
        <p className="mt-1 text-sm text-gray-600">Enter an email and we’ll send a secure registration link.</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <input className="w-full rounded-xl border p-3" type="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="employee@company.com" required />
          <button className="w-full rounded-xl bg-black p-3 text-white disabled:opacity-60" disabled={loading}>
            {loading ? "Sending…" : "Send Invite"}
          </button>
        </form>
        {note && <p className={`mt-4 text-sm ${note.type === "ok" ? "text-green-600" : "text-red-600"}`}>{note.text}</p>}
      </div>
    </main>
  );
}