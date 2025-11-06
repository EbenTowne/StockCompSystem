import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

const API = import.meta.env.VITE_API_URL as string;

type GrantListItem = {
  id: number;
  stock_class_name: string | null;
  series_name: string | null;
  num_shares: number;
  iso_shares: number;
  nqo_shares: number;
  rsu_shares: number;
  common_shares: number;
  preferred_shares: number;
  vesting_status?: string; // may include words and/or a percent like "Vesting 83%"
  strike_price: string | null;
  purchase_price: string | null;
};

type CompanyResp = { current_fmv: string };

export default function ManageGrants() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const urlId = sp.get("id") ?? "";

  const [uniqueId, setUniqueId] = useState(urlId);
  const [items, setItems] = useState<GrantListItem[] | null>(null);
  const [companyFMV, setCompanyFMV] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // keep Authorization like the list page
  useEffect(() => {
    const access = localStorage.getItem("accessToken");
    if (access) axios.defaults.headers.common["Authorization"] = `Bearer ${access}`;
  }, []);

  async function load(id: string) {
    if (!id) return;
    setLoading(true);
    setNote(null);
    try {
      const grantsUrl = `${API}/equity/employees/${encodeURIComponent(id)}/grants/`;
      const companyUrl = `${API}/company/`;
      const [grantsRes, companyRes] = await Promise.all([
        axios.get(grantsUrl),
        axios.get<CompanyResp>(companyUrl),
      ]);
      setItems(Array.isArray(grantsRes.data) ? grantsRes.data : []);
      setCompanyFMV(companyRes.data?.current_fmv ?? null);
    } catch (e: any) {
      setItems([]);
      setCompanyFMV(null);
      setNote({ type: "err", text: apiErr(e) });
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = uniqueId.trim();
    setSp(id ? { id } : {});
    void load(id);
  }

  useEffect(() => {
    // load automatically if ?id= is present
    if (urlId) void load(urlId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlId]);

  const hasQuery = useMemo(() => Boolean((uniqueId || urlId).trim()), [uniqueId, urlId]);

  // ---------- Priority sorting to mirror Employee Dashboard ----------
  // Helpers
  const toNumber = (v: string | number | null | undefined): number => {
    if (v == null || v === "") return 0;
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n) ? (n as number) : 0;
  };

  const pricePerShare = (g: GrantListItem): number => {
    // For RSUs use company FMV; for options prefer strike, then purchase, else FMV fallback
    const fmv = toNumber(companyFMV);
    if (g.rsu_shares > 0) return fmv;
    const strike = toNumber(g.strike_price);
    const purchase = toNumber(g.purchase_price);
    return strike || purchase || fmv;
  };

  const estimatedValue = (g: GrantListItem): number => {
    // Proxy for "vested value" since we don't have vested_shares here
    return toNumber(g.num_shares) * pricePerShare(g);
  };

  const pctFromStatus = (status?: string): number => {
    if (!status) return 0;
    const lower = status.toLowerCase();
    if (lower.includes("fully vested")) return 1;
    // Try to extract a number followed by %
    const m = status.match(/(\d{1,3})\s*%/);
    if (m) {
      const p = Math.max(0, Math.min(100, Number(m[1])));
      return p / 100;
    }
    // "Immediate Vesting" should count as fully vested
    if (lower.includes("immediate")) return 1;
    if (lower.includes("not vested")) return 0;
    // Unknown -> treat as 0 progress (conservative)
    return 0;
  };

  const typeOf = (g: GrantListItem): string => {
    if (g.preferred_shares > 0) return "PREFERRED";
    if (g.common_shares > 0) return "COMMON";
    if (g.rsu_shares > 0) return "RSU";
    if (g.iso_shares > 0) return "ISO";
    if (g.nqo_shares > 0) return "NQO";
    return "—";
  };

  const sorted = useMemo(() => {
    if (!items?.length) return [];

    // High vs Low split by median of estimated values
    const vals = items.map(estimatedValue).sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;

    const CLOSE = 0.8; // close to fully vesting

    const priority = (g: GrantListItem) => {
      const pct = pctFromStatus(g.vesting_status);
      const fully = pct >= 1;
      const high = estimatedValue(g) >= median;
      const close = pct >= CLOSE && pct < 1;

      if (fully) return 5;         // fully vested last
      if (high && close) return 1; // 1) high value & close to full
      if (high) return 2;          // 2) high value (any progress)
      if (!high && close) return 3;// 3) low value & close to full
      return 4;                    // 4) low value & not close
    };

    const ts = (g: GrantListItem) => 0; // no date info here; keep stable order within tie-breakers

    return [...items].sort((a, b) => {
      const pa = priority(a), pb = priority(b);
      if (pa !== pb) return pa - pb;

      const va = estimatedValue(a), vb = estimatedValue(b);
      if (va !== vb) return vb - va;

      const pca = pctFromStatus(a.vesting_status), pcb = pctFromStatus(b.vesting_status);
      if (pca !== pcb) return pcb - pca;

      return ts(b) - ts(a);
    });
  }, [items, companyFMV]);
  // -------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-4 px-6">
      <div className="w-full">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden w-full ring-1 ring-black/5">
          <div className="px-8 py-6">
            {/* Page header */}
            <div className="mb-8 text-center">
              <h1 className="text-3xl font-bold text-gray-900">Manage Existing Options</h1>
            </div>

            {/* Alerts */}
            {note && (
              <div
                className={`rounded-lg border p-3 text-sm mb-6 ${
                  note.type === "ok"
                    ? "border-green-200 bg-green-50 text-green-700"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                {note.text}
              </div>
            )}

            {/* Search */}
            <form
              onSubmit={onSubmit}
              className={`mx-auto max-w-2xl flex items-stretch gap-2 ${
                items?.length ? "mb-16 md:mb-20" : "mb-8"
              }`}
            >
              <input
                id="emp-uid"
                autoFocus
                value={uniqueId}
                onChange={(e) => setUniqueId(e.target.value)}
                placeholder="Enter ID (e.g., 1234-567-890)"
                className="flex-1 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                disabled={!uniqueId.trim()}
              >
                Search
              </button>
            </form>

            {/* Results */}
            {!hasQuery ? (
              <div className="p-6 bg-gray-50 rounded-lg border text-sm text-gray-700 mx-auto max-w-2xl">
                Enter an <b>Employee ID</b> in the searchbar above to view their issued options.
                Alternatively you can navigate to "Manage Employees" and select "Manage" next to the
                desired employee.
              </div>
            ) : loading ? (
              <div className="p-6 bg-gray-50 rounded-lg border mx-auto max-w-2xl">Loading…</div>
            ) : !items?.length ? (
              <div className="p-6 bg-gray-50 rounded-lg border mx-auto max-w-2xl">
                No grants found for <span className="font-medium">{urlId || uniqueId}</span>.
              </div>
            ) : (
              <div className="mt-6 md:mt-10 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {sorted.map((g) => {
                  const type = typeOf(g);
                  const rawPrice =
                    g.rsu_shares > 0 ? companyFMV : g.strike_price ?? g.purchase_price ?? null;
                  const price = rawPrice != null ? formatMoney(rawPrice) : null;

                  const effectiveId = (urlId || uniqueId).trim();

                  return (
                    <article
                      key={g.id}
                      className="bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="px-4 py-3 space-y-2">
                        <StatRow label="Class" value={g.stock_class_name ?? "—"} />
                        <StatRow label="Series" value={g.series_name ?? "—"} />
                        <StatRow
                          label="Total Shares"
                          value={g.num_shares ? g.num_shares.toLocaleString() : "—"}
                        />
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <Pill label="Type" value={type} />
                          <Pill label="Status" value={g.vesting_status ?? "—"} />
                        </div>
                        <div className="border-t mt-2" />
                        <StatRow label="Price" value={price ? `$${price}` : "—"} />
                      </div>
                      <div className="px-4 pb-4 pt-2">
                        <Link
                          to={`/dashboard/grants/${encodeURIComponent(effectiveId)}/${g.id}`}
                          className="inline-flex items-center justify-center px-3 py-2 rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 w-full"
                        >
                          Select
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: React.ReactNode }) {
  let displayValue = String(value ?? "—").trim();
  const lower = displayValue.toLowerCase();
  if (lower.includes("immediate vest")) displayValue = "Immediate Vesting";
  else if (lower.includes("fully vested")) displayValue = "Fully Vested";
  else if (lower.includes("not vested")) displayValue = "Not Vested";

  const colorClass =
    displayValue === "Immediate Vesting" || displayValue === "Fully Vested"
      ? "text-green-700"
      : displayValue === "Not Vested"
      ? "text-gray-700"
      : "text-gray-800";

  return (
    <div className="flex items-center justify-between rounded-lg border px-2.5 py-1.5 bg-gray-50">
      <span className="text-[11px] text-gray-500">{label}</span>
      <span className={`text-[12px] font-medium ${colorClass}`}>{displayValue}</span>
    </div>
  );
}

function formatMoney(v: string | number): string {
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "";
  return n.toFixed(2);
}

function apiErr(e: any) {
  const d = e?.response?.data;
  if (!d) return "Request failed.";
  if (typeof d === "string") return d;
  if (d.detail) return d.detail;
  return Object.entries(d)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join(" ");
}