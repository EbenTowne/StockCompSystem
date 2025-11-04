import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API_BASE } from "../auth";
import { useNavigate } from "react-router-dom";

// ---------- Types ----------
type Me = {
  role: "employee" | "employer";
  name: string;
  company: string;
  unique_id: string;
};

type GrantDetail = {
  id: number;

  // raw inputs
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

  // labels
  stock_class_name?: string | null;
  series_name?: string | null;

  // server-provided/derived
  fmv?: number | string | null;
  vested_value?: number | string | null;
  grant_date?: string | null;
  vested_shares?: number;
  unvested_shares?: number;
};

// ---------- Helpers ----------
const toNumber = (x: any, fallback = 0) => {
  if (x === null || x === undefined || x === "") return fallback;
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
};
const currency = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD" });
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : "—";

// ---------- Component ----------
export default function EmployeeDashboardPage() {
  const nav = useNavigate();
  const [me, setMe] = useState<Me | null>(null);
  const [grants, setGrants] = useState<GrantDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

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

        // who am I?
        const meRes = await axios.get<Me>("/accountInfo/");
        if (cancelled) return;
        if (meRes.data.role !== "employee") {
          nav("/dashboard");
          return;
        }
        setMe(meRes.data);

        // my grants
        const gRes = await axios.get<GrantDetail[] | { results: GrantDetail[] }>(
          "/equity/me/grants/"
        );
        if (cancelled) return;
        const list = Array.isArray(gRes.data) ? gRes.data : (gRes.data as any)?.results ?? [];
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

  // Totals
  const totals = useMemo(() => {
    let totalGranted = 0;
    let totalVested = 0;
    let totalUnvested = 0;
    let totalVestedValue = 0;
    let totalGrantedValue = 0;

    for (const g of grants) {
      const granted = toNumber(g.num_shares);
      const vested = toNumber(g.vested_shares);
      const unvested =
        "unvested_shares" in g ? toNumber(g.unvested_shares) : Math.max(granted - vested, 0);

      totalGranted += granted;
      totalVested += vested;
      totalUnvested += unvested;

      let vValue = toNumber(g.vested_value, NaN);
      if (Number.isNaN(vValue)) vValue = vested * toNumber(g.fmv ?? 0);
      totalVestedValue += vValue;

      totalGrantedValue += granted * toNumber(g.fmv ?? 0);
    }
    return { totalGranted, totalVested, totalUnvested, totalVestedValue, totalGrantedValue };
  }, [grants]);

  const headerFMV = currency(toNumber(grants[0]?.fmv ?? 0));

  // ---------- UI (deployment-ready polish) ----------
  if (loading)
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-10 px-6">
        <div className="mx-auto max-w-7xl bg-white/80 backdrop-blur rounded-2xl shadow-xl ring-1 ring-black/5 p-10 text-center text-gray-700">
          Loading your dashboard…
        </div>
      </div>
    );

  if (err)
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-10 px-6">
        <div className="mx-auto max-w-7xl bg-white/80 backdrop-blur rounded-2xl shadow-xl ring-1 ring-black/5 p-6">
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 text-red-700 p-4 text-sm"
          >
            {err}
          </div>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Full-width but readable content max */}
      <main className="w-full py-8 md:py-10 lg:py-12 px-4 md:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-7xl bg-white rounded-2xl shadow-xl ring-1 ring-black/5">
          <div className="px-6 md:px-8 lg:px-10 py-8 md:py-10 space-y-8">
            {/* ===== Header ===== */}
            <section className="rounded-xl border border-gray-100 p-6 md:p-8 shadow-sm">
              <div className="flex items-center justify-between">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-gray-900">
                  Welcome, {me?.name || "Employee"}
                </h1>
              </div>

              {/* Compact meta row */}
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 text-sm text-gray-700">
                <div className="inline-flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium">
                    Company
                  </span>
                  <span className="font-medium">{me?.company}</span>
                </div>
                <span className="hidden sm:block text-gray-300">•</span>
                <div className="inline-flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium">
                    Employee ID
                  </span>
                  <span className="tabular-nums">{me?.unique_id}</span>
                </div>
                <span className="hidden sm:block text-gray-300">•</span>
                <div className="inline-flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
                    Company FMV
                  </span>
                  <span className="tabular-nums">{headerFMV}</span>
                </div>
              </div>
            </section>

            {/* ===== Summary ===== */}
            <section className="rounded-xl border border-gray-100 p-6 md:p-8 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Summary</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Card */}
                <div className="group rounded-xl ring-1 ring-gray-200 bg-gray-50 p-4 hover:bg-white hover:shadow transition">
                  <div className="text-[11px] font-medium tracking-wide text-gray-500">
                    GRANTED SHARES
                  </div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">
                    {totals.totalGranted.toLocaleString()}
                  </div>
                </div>
                <div className="group rounded-xl ring-1 ring-gray-200 bg-gray-50 p-4 hover:bg-white hover:shadow transition">
                  <div className="text-[11px] font-medium tracking-wide text-gray-500">
                    TOTAL UNVESTED
                  </div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">
                    {totals.totalUnvested.toLocaleString()}
                  </div>
                </div>
                <div className="group rounded-xl ring-1 ring-gray-200 bg-gray-50 p-4 hover:bg-white hover:shadow transition">
                  <div className="text-[11px] font-medium tracking-wide text-gray-500">
                    TOTAL VESTED
                  </div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">
                    {totals.totalVested.toLocaleString()}
                  </div>
                </div>
                <div className="group rounded-xl ring-1 ring-gray-200 bg-gray-50 p-4 hover:bg-white hover:shadow transition">
                  <div className="text-[11px] font-medium tracking-wide text-gray-500">
                    VESTED VALUE
                  </div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">
                    {currency(totals.totalVestedValue)}
                  </div>
                </div>
              </div>
            </section>

            {/* ===== Grants ===== */}
            {grants.map((g) => {
              const granted = toNumber(g.num_shares);
              const vested = toNumber(g.vested_shares);
              const unvested =
                "unvested_shares" in g
                  ? toNumber(g.unvested_shares)
                  : Math.max(granted - vested, 0);
              const fmv = toNumber(g.fmv ?? 0);

              // purely visual: show vesting progress if we know granted
              const pct =
                granted > 0 ? Math.min(100, Math.max(0, (vested / granted) * 100)) : 0;

              return (
                <section
                  key={g.id}
                  className="relative rounded-xl border border-gray-100 p-6 md:p-8 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-base md:text-lg font-semibold text-gray-900">
                      Grant ID: <span className="tabular-nums">{g.id}</span>
                    </h3>

                    {/* progress pill (visual only) */}
                    <div
                      className="hidden sm:flex items-center gap-2 text-xs font-medium px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700"
                      aria-label="Vesting progress"
                      title={`Vested ${vested.toLocaleString()} of ${granted.toLocaleString()} (${pct.toFixed(
                        0
                      )}%)`}
                    >
                      <span className="tabular-nums">{pct.toFixed(0)}%</span>
                      <div className="h-1 w-16 rounded-full bg-indigo-100 overflow-hidden">
                        <div
                          className="h-1 bg-indigo-600"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-6 text-sm text-gray-800">
                    {/* Dates */}
                    <div className="space-y-1">
                      <div>
                        <span className="text-gray-500">Granted:</span> {fmtDate(g.grant_date)}
                      </div>
                      <div>
                        <span className="text-gray-500">Start Date:</span>{" "}
                        {fmtDate(g.vesting_start)}
                      </div>
                      <div>
                        <span className="text-gray-500">End Date:</span> {fmtDate(g.vesting_end)}
                      </div>
                    </div>

                    {/* Shares */}
                    <div className="space-y-1">
                      <div className="tabular-nums">
                        <span className="text-gray-500">Vested shares:</span>{" "}
                        {vested.toLocaleString()}
                      </div>
                      <div className="tabular-nums">
                        <span className="text-gray-500">Unvested shares:</span>{" "}
                        {unvested.toLocaleString()}
                      </div>
                      <div className="tabular-nums">
                        <span className="text-gray-500">Total granted:</span>{" "}
                        {granted.toLocaleString()}
                      </div>
                    </div>

                    {/* Money / Prices */}
                    <div className="space-y-1">
                      <div className="tabular-nums">
                        <span className="text-gray-500">Vested value:</span>{" "}
                        {currency(toNumber(g.vested_value ?? vested * fmv))}
                      </div>
                      <div className="tabular-nums">
                        <span className="text-gray-500">Strike Price:</span>{" "}
                        {g.strike_price ?? "N/A"}
                      </div>
                      <div className="tabular-nums">
                        <span className="text-gray-500">Purchase Price:</span>{" "}
                        {g.purchase_price ?? "N/A"}
                      </div>
                    </div>
                  </div>

                  {/* subtle divider */}
                  <div className="mt-6 h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
                </section>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}