import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API_BASE } from "../auth";
import { useNavigate } from "react-router-dom";

/* ──────────────────────────────────────────────────────────────
   Types
   ────────────────────────────────────────────────────────────── */
type Me = {
  role: "employee" | "employer";
  name: string;
  company: string;
  unique_id: string;
};

export type GrantDetail = {
  id: number;
  num_shares?: number;
  iso_shares?: number;
  nqo_shares?: number;
  rsu_shares?: number;
  common_shares?: number;
  preferred_shares?: number;
  strike_price?: number | null;
  purchase_price?: number | null;
  vesting_start?: string | null;
  vesting_end?: string | null;
  vesting_frequency?: string | null;
  shares_per_period?: number | null;
  stock_class_name?: string | null;
  series_name?: string | null;
  fmv?: number | string | null;
  vested_value?: number | string | null;
  grant_date?: string | null;
  vested_shares?: number;
  unvested_shares?: number;
};

/* ──────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────── */
const toNumber = (x: any, fallback = 0) => {
  if (x === null || x === undefined || x === "") return fallback;
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
};

const currency = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD" });

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : "—";

function grantStatus(g: GrantDetail): {
  label: string;
  tone: "gray" | "indigo" | "green";
  pct: number;
} {
  const granted = toNumber(g.num_shares);
  const vested = toNumber(g.vested_shares);
  const pct =
    granted > 0 ? Math.min(100, Math.max(0, (vested / granted) * 100)) : 0;

  const now = new Date();
  const start = g.vesting_start ? new Date(g.vesting_start) : null;
  const end = g.vesting_end ? new Date(g.vesting_end) : null;

  if (granted === 0) return { label: "No shares", tone: "gray", pct };
  if (pct >= 100) return { label: "Fully vested", tone: "green", pct };
  if (start && now < start) return { label: "Not started", tone: "gray", pct };
  if (end && now > end && pct < 100)
    return { label: "Vesting complete", tone: "gray", pct };
  return { label: "Vesting", tone: "indigo", pct };
}

function eqType(g: GrantDetail): "ISO" | "NSO" | "RSU" | "Common" | "Preferred" | "Equity" {
  if (toNumber(g.iso_shares) > 0) return "ISO";
  if (toNumber(g.nqo_shares) > 0) return "NSO";
  if (toNumber(g.rsu_shares) > 0) return "RSU";
  if (toNumber(g.common_shares) > 0) return "Common";
  if (toNumber(g.preferred_shares) > 0) return "Preferred";
  return "Equity";
}

const vestedValueOf = (g: GrantDetail) => {
  // prefer provided vested_value if numeric; else estimate
  const vv = toNumber(g.vested_value, NaN);
  if (!Number.isNaN(vv)) return vv;
  return toNumber(g.vested_shares) * toNumber(g.fmv ?? 0);
};

const pctVestedOf = (g: GrantDetail) => {
  const granted = toNumber(g.num_shares);
  const vested = toNumber(g.vested_shares);
  return granted > 0 ? Math.max(0, Math.min(1, vested / granted)) : 0;
};

/* ──────────────────────────────────────────────────────────────
   Component
   ────────────────────────────────────────────────────────────── */
export default function EmployeeDashboardPage() {
  const nav = useNavigate();

  const [me, setMe] = useState<Me | null>(null);
  const [grants, setGrants] = useState<GrantDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Keep all dropdowns CLOSED on initial page load
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const toggleExpanded = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const expandAll = () => setExpandedIds(new Set(grants.map((g) => g.id)));
  const collapseAll = () => setExpandedIds(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        const accessToken =
          localStorage.getItem("accessToken") ||
          localStorage.getItem("access_token") ||
          "";
        if (!accessToken) {
          nav("/login");
          return;
        }

        axios.defaults.baseURL = API_BASE;
        axios.defaults.headers.common["Authorization"] = `Bearer ${accessToken}`;

        const meRes = await axios.get<Me>("/accountInfo/");
        if (cancelled) return;
        if (meRes.data.role !== "employee") {
          nav("/dashboard");
          return;
        }
        setMe(meRes.data);

        const gRes = await axios.get<GrantDetail[] | { results?: GrantDetail[] }>(
          "/equity/me/grants/"
        );
        if (cancelled) return;

        const list: GrantDetail[] = Array.isArray(gRes.data)
          ? (gRes.data as GrantDetail[])
          : (gRes.data?.results ?? []);

        // Do NOT auto-expand any item
        setExpandedIds(new Set());
        setGrants(list);
      } catch (e: any) {
        if (!cancelled) {
          const msg =
            e?.response?.data?.detail ||
            e?.response?.data?.message ||
            "Failed to load your grants.";
          setErr(msg);
          if ([401, 403].includes(e?.response?.status)) nav("/login");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nav]);

  // Summary totals
  const totals = useMemo(() => {
    let totalGranted = 0;
    let totalVested = 0;
    let totalUnvested = 0;
    let totalVestedValue = 0;

    for (const g of grants) {
      const granted = toNumber(g.num_shares);
      const vested = toNumber(g.vested_shares);
      const unvested =
        "unvested_shares" in g ? toNumber(g.unvested_shares) : Math.max(granted - vested, 0);
      totalGranted += granted;
      totalVested += vested;
      totalUnvested += unvested;
      totalVestedValue += vestedValueOf(g);
    }
    return { totalGranted, totalVested, totalUnvested, totalVestedValue };
  }, [grants]);

  const headerFMV = currency(toNumber(grants[0]?.fmv ?? 0));

  // Priority sort per your rules
  const sortedGrants = useMemo(() => {
    if (!grants.length) return [];

    // Median vested value to split High vs Low
    const values = grants.map(vestedValueOf).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const median =
      values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;

    const CLOSE = 0.8; // "close to fully vesting" = ≥80% and <100%

    const vv = (g: GrantDetail) => vestedValueOf(g);
    const pct = (g: GrantDetail) => pctVestedOf(g);
    const ts = (g: GrantDetail) => (g.grant_date ? Date.parse(g.grant_date) : 0);

    const priority = (g: GrantDetail) => {
      const p = pct(g);
      const high = vv(g) >= median;
      const close = p >= CLOSE && p < 1;
      if (p >= 1) return 5;           // fully vested (always last)
      if (high && close) return 1;    // 1) high value & close to full
      if (high) return 2;             // 2) high value (any status)
      if (!high && close) return 3;   // 3) low value & close to full
      return 4;                       // 4) low value & not close
    };

    return [...grants].sort((a, b) => {
      const pa = priority(a), pb = priority(b);
      if (pa !== pb) return pa - pb;

      // Within bucket: vested value desc, then % vested desc, then newest first
      const vva = vv(a), vvb = vv(b);
      if (vva !== vvb) return vvb - vva;

      const pca = pct(a), pcb = pct(b);
      if (pca !== pcb) return pcb - pca;

      return ts(b) - ts(a);
    });
  }, [grants]);

  /* ────────────────────────────────────────────────────────────
     UI
     ──────────────────────────────────────────────────────────── */
  if (loading)
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-10 px-6">
        <div className="mx-auto max-w-[1400px] bg-white/80 backdrop-blur rounded-2xl shadow-xl ring-1 ring-black/5 p-10 text-center text-gray-700">
          Loading your dashboard…
        </div>
      </div>
    );

  if (err)
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-10 px-6">
        <div className="mx-auto max-w-[1400px] bg-white/80 backdrop-blur rounded-2xl shadow-xl ring-1 ring-black/5 p-6">
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 text-red-700 p-4 text-sm">
            {err}
          </div>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* HEADER (full width with gutters) */}
      <header className="w-full bg-white border-b border-gray-100 shadow-sm">
        <div className="w-full max-w-none px-3 sm:px-6 lg:px-10 xl:px-12 pt-8 md:pt-10 pb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
            Welcome, {me?.name || "Employee"}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-700">
            <div className="inline-flex items-center gap-2 min-w-0">
              <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium flex-shrink-0">
                Company
              </span>
              <span className="font-medium truncate">{me?.company}</span>
            </div>
            <span className="hidden sm:inline text-gray-300">•</span>
            <div className="inline-flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium">
                Employee ID
              </span>
              <span className="tabular-nums">{me?.unique_id}</span>
            </div>
            <span className="hidden sm:inline text-gray-300">•</span>
            <div className="inline-flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
                Company FMV
              </span>
              <span className="tabular-nums">{headerFMV}</span>
            </div>
          </div>

          {/* SUMMARY CARDS: full header width (inside gutters) */}
          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
            {[
              ["GRANTED", totals.totalGranted.toLocaleString()],
              ["UNVESTED", totals.totalUnvested.toLocaleString()],
              ["VESTED", totals.totalVested.toLocaleString()],
              ["VESTED VALUE", currency(totals.totalVestedValue)],
            ].map(([label, val]) => (
              <div
                key={label}
                className="rounded-xl ring-1 ring-gray-200 bg-gray-50 p-4 text-center shadow-sm"
              >
                <div className="text-[11px] font-medium tracking-wider text-gray-500">
                  {label}
                </div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{val}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* OPTIONS (aligned to the same gutters as header) */}
      <main className="w-full">
        <div className="w-full max-w-none px-3 sm:px-6 lg:px-10 xl:px-12 py-8 md:py-10">
          {/* Toolbar */}
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {sortedGrants.length} {sortedGrants.length === 1 ? "option" : "options"}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={expandAll}
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Expand all
              </button>
              <button
                type="button"
                onClick={collapseAll}
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Collapse all
              </button>
            </div>
          </div>

          {/* DROPDOWNS */}
          <div className="space-y-6">
            {sortedGrants.map((g) => {
              const granted = toNumber(g.num_shares);
              const vested = toNumber(g.vested_shares);
              const unvested =
                "unvested_shares" in g ? toNumber(g.unvested_shares) : Math.max(granted - vested, 0);
              const fmv = toNumber(g.fmv ?? 0);
              const st = grantStatus(g);
              const type = eqType(g);
              const heading = `${type} Stock Option`;
              const isOpen = expandedIds.has(g.id);

              return (
                <section
                  key={g.id}
                  className={
                    "w-full rounded-xl border border-gray-100 bg-white shadow-sm transition-all duration-200 " +
                    (isOpen ? "p-5 md:p-6 hover:shadow-md" : "p-3 md:p-3 hover:shadow")
                  }
                >
                  {/* Collapsed row */}
                  {!isOpen && (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm md:text-base font-semibold text-gray-900 truncate">
                          {heading}
                        </h3>
                        <div className="mt-0.5 text-xs text-gray-600 tabular-nums">
                          Granted: {granted.toLocaleString()}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span
                          className={
                            "text-[11px] font-medium px-2.5 py-1 rounded-full " +
                            (st.tone === "green"
                              ? "bg-green-50 text-green-700"
                              : st.tone === "indigo"
                              ? "bg-indigo-50 text-indigo-700"
                              : "bg-gray-100 text-gray-700")
                          }
                        >
                          {st.label}
                        </span>
                        <div className="hidden sm:flex items-center gap-2 text-[11px] font-medium text-gray-700">
                          <span className="tabular-nums">{st.pct.toFixed(0)}%</span>
                          <div className="h-1.5 w-20 rounded-full bg-gray-200 overflow-hidden">
                            <div className="h-1.5 bg-indigo-600" style={{ width: `${st.pct}%` }} />
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(g.id)}
                          className="inline-flex items-center gap-1 text-xs font-medium rounded-md border border-gray-200 px-2.5 py-1 hover:bg-gray-50 transition"
                          aria-expanded={false}
                          aria-controls={`grant-${g.id}-details`}
                        >
                          Show details
                          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                            <path
                              fillRule="evenodd"
                              d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Expanded row */}
                  {isOpen && (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-base md:text-lg font-semibold text-gray-900">
                            {heading}
                          </h3>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-700">
                            {g.stock_class_name && (
                              <span className="rounded-full bg-gray-100 text-gray-700 px-2 py-0.5">
                                {g.stock_class_name}
                              </span>
                            )}
                            {g.series_name && (
                              <span className="rounded-full bg-gray-100 text-gray-700 px-2 py-0.5">
                                {g.series_name}
                              </span>
                            )}
                            <span className="rounded-md bg-gray-50 px-2 py-0.5 tabular-nums">
                              Granted: {granted.toLocaleString()}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 flex-shrink-0 pt-1">
                          <span
                            className={
                              "text-xs font-medium px-2.5 py-1 rounded-full " +
                              (st.tone === "green"
                                ? "bg-green-50 text-green-700"
                                : st.tone === "indigo"
                                ? "bg-indigo-50 text-indigo-700"
                                : "bg-gray-100 text-gray-700")
                            }
                          >
                            {st.label}
                          </span>
                          <div className="hidden sm:flex items-center gap-2 text-xs font-medium text-gray-700">
                            <span className="tabular-nums">{st.pct.toFixed(0)}%</span>
                            <div className="h-1.5 w-24 rounded-full bg-gray-200 overflow-hidden">
                              <div className="h-1.5 bg-indigo-600" style={{ width: `${st.pct}%` }} />
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => toggleExpanded(g.id)}
                            className="inline-flex items-center gap-1 text-xs font-medium rounded-md border border-gray-200 px-2.5 py-1 hover:bg-gray-50 transition"
                            aria-expanded={true}
                            aria-controls={`grant-${g.id}-details`}
                          >
                            Hide details
                            <svg
                              viewBox="0 0 20 20"
                              fill="currentColor"
                              className="h-3.5 w-3.5 rotate-180"
                            >
                              <path
                                fillRule="evenodd"
                                d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>

                      <div className="mt-5">
                        <div
                          id={`grant-${g.id}-details`}
                          className="grid grid-cols-1 lg:grid-cols-3 gap-4"
                        >
                          {/* Schedule */}
                          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                            <div className="text-[11px] font-semibold tracking-wider text-gray-500">
                              SCHEDULE
                            </div>
                            <dl className="mt-2 grid grid-cols-1 gap-1 text-sm">
                              <div className="flex justify-between gap-3">
                                <dt className="text-gray-600">Start</dt>
                                <dd className="tabular-nums">{fmtDate(g.vesting_start)}</dd>
                              </div>
                              <div className="flex justify-between gap-3">
                                <dt className="text-gray-600">End</dt>
                                <dd className="tabular-nums">{fmtDate(g.vesting_end)}</dd>
                              </div>
                              <div className="flex justify-between gap-3">
                                <dt className="text-gray-600">Frequency</dt>
                                <dd className="tabular-nums">{g.vesting_frequency ?? "—"}</dd>
                              </div>
                              {g.shares_per_period && (
                                <div className="flex justify-between gap-3">
                                  <dt className="text-gray-600">Shares / period</dt>
                                  <dd className="tabular-nums">
                                    {toNumber(g.shares_per_period).toLocaleString()}
                                  </dd>
                                </div>
                              )}
                            </dl>
                          </div>

                          {/* Shares */}
                          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                            <div className="text-[11px] font-semibold tracking-wider text-gray-500">
                              SHARES
                            </div>
                            <dl className="mt-2 grid grid-cols-1 gap-1 text-sm">
                              <div className="flex justify-between gap-3">
                                <dt className="text-gray-600">Granted</dt>
                                <dd className="tabular-nums">
                                  {granted.toLocaleString()}
                                </dd>
                              </div>
                              <div className="flex justify-between gap-3">
                                <dt className="text-gray-600">Vested</dt>
                                <dd className="tabular-nums">
                                  {vested.toLocaleString()}
                                </dd>
                              </div>
                              <div className="flex justify-between gap-3">
                                <dt className="text-gray-600">Unvested</dt>
                                <dd className="tabular-nums">
                                  {unvested.toLocaleString()}
                                </dd>
                              </div>
                            </dl>
                          </div>

                          {/* Value */}
                          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                            <div className="text-[11px] font-semibold tracking-wider text-gray-500">
                              VALUE
                            </div>
                            <dl className="mt-2 grid grid-cols-1 gap-1 text-sm">
                              <div className="flex justify-between gap-3">
                                <dt className="text-gray-600">FMV</dt>
                                <dd className="tabular-nums">{currency(fmv)}</dd>
                              </div>
                              <div className="flex justify-between gap-3">
                                <dt className="text-gray-600">Strike</dt>
                                <dd className="tabular-nums">{g.strike_price ?? "N/A"}</dd>
                              </div>
                              <div className="flex justify-between gap-3">
                                <dt className="text-gray-600">Vested value</dt>
                                <dd className="tabular-nums">
                                  {currency(vestedValueOf(g))}
                                </dd>
                              </div>
                            </dl>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </section>
              );
            })}

            {sortedGrants.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white/60 p-8 text-center text-gray-600">
                No grants found.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}