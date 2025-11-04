import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useDeferredValue,
} from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL as string;

// ---------------------- small session cache (60s) ----------------------------
const CACHE_TTL_MS = 60_000;
function ssGet<T>(k: string): T | null {
  try {
    const raw = sessionStorage.getItem(k);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.t !== "number" || Date.now() - obj.t > CACHE_TTL_MS)
      return null;
    return obj.v as T;
  } catch {
    return null;
  }
}
function ssSet<T>(k: string, v: T) {
  try {
    sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), v }));
  } catch {}
}

// --------------------------------- types -------------------------------------
type CapRow = {
  unique_id: string;
  name: string;
  total_shares: number;
  ownership_pct: number;
};
type CapTableResponse = {
  market_cap: number; // shown in UI as "Authorized shares"
  rows: CapRow[];
};

type Employee = {
  unique_id: string;
  name?: string;
  username?: string;
  user?: { first_name?: string; username?: string };
};

type EmployeeAgg = {
  unique_id: string;
  name: string;
  total_shares: number;
  ownership_pct: number;
  grants_count: number;
};

function apiErr(e: any) {
  const d = e?.response?.data;
  if (!d) return "Request failed.";
  if (typeof d === "string") return d;
  if (d.detail) return d.detail;
  try {
    return Object.entries(d)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
      .join(" ");
  } catch {
    return "Request failed.";
  }
}

// -------------------------------- component ----------------------------------
export default function ViewEmployees() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );
  const [authorizedShares, setAuthorizedShares] = useState<number>(0);
  const [capRows, setCapRows] = useState<CapRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [q, setQ] = useState("");

  const [showInvite, setShowInvite] = useState(false);

  const qDeferred = useDeferredValue(q);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const access = localStorage.getItem("accessToken");
    if (access)
      axios.defaults.headers.common["Authorization"] = `Bearer ${access}`;
    void load();
    return () => abortRef.current?.abort();
  }, []);

  async function load() {
    setLoading(true);
    setNote(null);

    // optimistic: show cache while fetching
    const cachedCap = ssGet<CapTableResponse>("cap-table");
    if (cachedCap?.rows) {
      setAuthorizedShares(cachedCap.market_cap ?? 0);
      setCapRows(cachedCap.rows);
    }
    const cachedEmps = ssGet<Employee[]>("employees-list");
    if (cachedEmps) setEmployees(cachedEmps);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const [capRes, empRes] = await Promise.all([
        axios.get<CapTableResponse>(`${API}/equity/cap-table/`, {
          signal: ctrl.signal,
        }),
        axios.get<Employee[]>(`${API}/employees/`, { signal: ctrl.signal }),
      ]);
      if (ctrl.signal.aborted) return;

      const emps = normalizeEmployees(empRes.data);
      setEmployees(emps);
      ssSet("employees-list", emps);

      setAuthorizedShares(capRes.data?.market_cap ?? 0);
      setCapRows(Array.isArray(capRes.data?.rows) ? capRes.data.rows : []);
      ssSet("cap-table", capRes.data);
    } catch (e: any) {
      if (!ctrl.signal.aborted) setNote({ type: "err", text: apiErr(e) });
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }

  async function onDeleteEmployee(unique_id: string, name: string) {
    const ok = confirm(
      `Delete ${name} and ALL their grants?\n\nThis cannot be undone.`
    );
    if (!ok) return;
    setNote(null);
    try {
      await axios.delete(`${API}/employees/${encodeURIComponent(unique_id)}/`);
      setNote({
        type: "ok",
        text: `Deleted ${name} and all associated grants.`,
      });
      await load();
    } catch (e: any) {
      setNote({ type: "err", text: apiErr(e) });
    }
  }

  // merge cap-table rows (sum dup rows) with employee list (ensures 0-grant users appear)
  const merged: EmployeeAgg[] = useMemo(() => {
    const capMap = new Map<
      string,
      { total_shares: number; ownership_pct: number; grants_count: number; name: string }
    >();
    for (const r of capRows) {
      const cur = capMap.get(r.unique_id);
      if (!cur) {
        capMap.set(r.unique_id, {
          total_shares: r.total_shares || 0,
          ownership_pct: r.ownership_pct || 0,
          grants_count: 1,
          name: r.name,
        });
      } else {
        cur.total_shares += r.total_shares || 0;
        cur.ownership_pct += r.ownership_pct || 0;
        cur.grants_count += 1;
      }
    }

    const list: EmployeeAgg[] = employees.map((e) => {
      const cap = capMap.get(e.unique_id);
      const displayName =
        e.name ||
        e.user?.first_name ||
        e.username ||
        e.user?.username ||
        cap?.name ||
        "—";
      return {
        unique_id: e.unique_id,
        name: displayName,
        total_shares: cap?.total_shares ?? 0,
        ownership_pct: cap?.ownership_pct ?? 0,
        grants_count: cap?.grants_count ?? 0,
      };
    });

    list.sort((a, b) => {
      if (b.ownership_pct !== a.ownership_pct)
        return b.ownership_pct - a.ownership_pct;
      if (b.total_shares !== a.total_shares)
        return b.total_shares - a.total_shares;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [capRows, employees]);

  const filtered = useMemo(() => {
    const s = qDeferred.trim().toLowerCase();
    if (!s) return merged;
    return merged.filter(
      (e) =>
        e.name.toLowerCase().includes(s) ||
        e.unique_id.toLowerCase().includes(s)
    );
  }, [merged, qDeferred]);

  // formatting
  const fmtInt = (n: number) =>
    typeof n === "number"
      ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)
      : "—";
  const fmtPct = (n: number) =>
    new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
      minimumFractionDigits: n > 0 && n < 0.01 ? 2 : 0,
    }).format(n) + "%";

  // ---------------------------------- UI -------------------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-4 px-6">
      <div className="w-full">
        {/* Match CompanyMetrics: single full-width card with same shadow/radius */}
        <section className="bg-white rounded-xl shadow-lg overflow-hidden w-full">
          {/* --- Header (clean, deployment-ready) --- */}
          <div className="px-8 py-6 border-b border-gray-100">
            <div className="flex items-start md:items-center justify-between gap-6">
              <div className="min-w-0">
                <h1 className="text-3xl font-bold text-gray-900">Employees</h1>
                <p className="text-sm text-gray-600">
                  Ranked by percentage of company ownership
                </p>
              </div>

              {/* Subtle badge mirrors metrics tone */}
              <div
                className="shrink-0 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 border border-gray-200"
                aria-label="Authorized shares"
              >
                Authorized shares:{" "}
                <span className="font-semibold">{fmtInt(authorizedShares)}</span>
              </div>
            </div>

            {/* Search under the title to reduce header clutter */}
            <div className="mt-5">
              <div className="relative">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by name or employee id"
                  aria-label="Search employees"
                className="w-full rounded-lg border border-gray-300 pr-10 pl-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <svg
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-4.35-4.35M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" />
                </svg>
              </div>
            </div>

            {note && (
              <div
                role="status"
                className={`mt-4 rounded-lg px-3 py-2 text-sm ${
                  note.type === "ok"
                    ? "bg-green-50 text-green-800 border border-green-200"
                    : "bg-red-50 text-red-800 border border-red-200"
                }`}
              >
                {note.text}
              </div>
            )}
          </div>

          {/* --- Table (tighter columns) --- */}
          <div className="px-8 pt-6">
            {loading ? (
              <div className="py-16 text-center text-gray-500">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center text-gray-500">
                {q ? "No matching employees." : "No employees found."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-[14px]">
                  <thead className="bg-white border-b border-gray-100">
                    <tr>
                      <Th className="w-10 text-center">#</Th>
                      <Th align="left">Employee</Th>
                      <Th>Unique ID</Th>
                      <Th align="right" className="whitespace-nowrap">
                        Grants
                      </Th>
                      <Th align="right" className="whitespace-nowrap">
                        Total Shares
                      </Th>
                      <Th align="right" className="whitespace-nowrap">
                        % Ownership
                      </Th>
                      {/* keep an empty header cell for action alignment */}
                      <Th className="w-48 text-right" aria-hidden="true" children={undefined}></Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map((e, i) => (
                      <tr
                        key={e.unique_id}
                        className="transition-colors hover:bg-gray-50/60"
                      >
                        <Td className="text-center text-gray-500 px-1.5">
                          {i + 1}
                        </Td>
                        <Td align="left" className="px-1.5">
                          <span className="font-medium text-gray-900 truncate block max-w-[420px]">
                            {e.name || "—"}
                          </span>
                        </Td>
                        <Td className="px-1.5">
                          <span className="inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] bg-gray-100 text-gray-700">
                            {e.unique_id}
                          </span>
                        </Td>
                        <Td align="right" className="px-1.5">
                          {fmtInt(e.grants_count)}
                        </Td>
                        <Td align="right" className="px-1.5">
                          {fmtInt(e.total_shares)}
                        </Td>
                        <Td align="right" className="px-1.5">
                          {fmtPct(e.ownership_pct)}
                        </Td>
                        <Td align="right" className="pl-4">
                          <div className="inline-flex gap-2">
                            <button
                              onClick={() =>
                                nav(
                                  `/dashboard/grants?id=${encodeURIComponent(
                                    e.unique_id
                                  )}`
                                )
                              }
                              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3.5 py-1.5 text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                              aria-label={`Manage grants for ${e.name ?? "employee"}`}
                            >
                              Manage
                            </button>
                            <button
                              onClick={() => onDeleteEmployee(e.unique_id, e.name)}
                              className="inline-flex items-center justify-center rounded-lg bg-red-600 px-3.5 py-1.5 text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                              aria-label={`Delete ${e.name ?? "employee"}`}
                            >
                              Delete
                            </button>
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* --- Footer actions (anchors the card visually like metrics) --- */}
          <div className="px-8 pb-8 pt-6 flex flex-col sm:flex-row gap-3 sm:items-center justify-between border-t border-gray-100">
            <div className="text-sm text-gray-500">
              Showing <span className="font-medium">{filtered.length}</span>{" "}
              {filtered.length === 1 ? "employee" : "employees"}
            </div>
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={load}
                className="px-3 py-2 rounded-lg border text-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                Reload
              </button>
              <button
                onClick={() => setShowInvite(true)}
                className="px-4 py-2 rounded-lg bg-black text-white text-sm hover:bg-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                Invite New Employee
              </button>
            </div>
          </div>
        </section>
      </div>

      {showInvite && (
        <InviteEmployeeModal
          onClose={() => setShowInvite(false)}
          onSent={() => void load()}
        />
      )}
    </div>
  );
}

// ------------------------------ invite modal ---------------------------------
function InviteEmployeeModal({
  onClose,
  onSent,
}: {
  onClose: () => void;
  onSent: () => void;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );

  useEffect(() => {
    const access = localStorage.getItem("accessToken");
    if (access)
      axios.defaults.headers.common["Authorization"] = `Bearer ${access}`;
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    if (!email.trim())
      return setNote({ type: "err", text: "Please enter an email." });

    setLoading(true);
    try {
      await axios.post(`${API}/invite/employee/`, { email });
      setNote({
        type: "ok",
        text: "Invite sent. Ask your employee to check their inbox.",
      });
      setEmail("");
      onSent();
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ??
        err?.response?.data?.error ??
        "Failed to send invite.";
      setNote({ type: "err", text: msg });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 grid place-items-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl relative">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 rounded-full border px-2.5 py-0.5 text-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Close"
          >
            ✕
          </button>

          <h2 className="text-xl font-semibold">Invite Employee</h2>
          <p className="mt-1 text-sm text-gray-600">
            Enter an email and we’ll send a secure registration link.
          </p>

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <label className="block">
              <span className="sr-only">Email</span>
              <input
                className="w-full rounded-xl border border-gray-300 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="employee@company.com"
                required
              />
            </label>
            <button
              className="w-full rounded-xl bg-black p-3 text-white text-sm disabled:opacity-60 hover:bg-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              disabled={loading}
            >
              {loading ? "Sending…" : "Send Invite"}
            </button>
          </form>

          {note && (
            <p
              className={`mt-4 text-sm ${
                note.type === "ok" ? "text-green-600" : "text-red-600"
              }`}
            >
              {note.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------ table cells ----------------------------------
function Th({
  children,
  align = "center",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const map = { left: "text-left", center: "text-center", right: "text-right" } as const;
  return (
    <th
      className={`px-1.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 ${map[align]} ${className}`}
      scope="col"
    >
      {children}
    </th>
  );
}
function Td({
  children,
  align = "center",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const map = { left: "text-left", center: "text-center", right: "text-right" } as const;
  return <td className={`px-1.5 py-2.5 ${map[align]} ${className}`}>{children}</td>;
}

// --------------------------------- helpers -----------------------------------
function normalizeEmployees(arr: any[]): Employee[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((e) => {
      const uid: string | undefined =
        e?.unique_id ?? e?.user?.unique_id ?? e?.slug;
      if (!uid) return null;
      const name: string | undefined =
        e?.name ||
        e?.user?.first_name ||
        e?.first_name ||
        e?.display_name ||
        e?.username ||
        e?.user?.username;
      return { unique_id: uid, name, username: e?.username, user: e?.user };
    })
    .filter(Boolean) as Employee[];
}