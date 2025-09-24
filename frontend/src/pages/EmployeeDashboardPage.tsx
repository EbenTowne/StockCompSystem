import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API_BASE } from "../auth";         // e.g. http://127.0.0.1:8000/api
import { useNavigate } from "react-router-dom";

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

  // NEW from backend
  fmv?: number | string | null;              // company FMV
  vested_value?: number | string | null;     // server-computed
  grant_date?: string | null;                // issue date

  // derived helpers from backend
  vested_shares?: number;
  unvested_shares?: number;
};

const toNumber = (x: any, fallback = 0) => {
  if (x === null || x === undefined || x === "") return fallback;
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
};
const currency = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD" });
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : "—";

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

        // ✅ only use ACCESS token
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

        // 1) who am I?
        const meRes = await axios.get<Me>("/accountInfo/"); // same endpoint
        if (cancelled) return;
        if (meRes.data.role !== "employee") {
          nav("/dashboard");
          return;
        }
        setMe(meRes.data);  // :contentReference[oaicite:5]{index=5}

        // 2) my grants (detailed)
        const gRes = await axios.get<GrantDetail[] | { results: GrantDetail[] }>(
          "/equity/me/grants/"
        ); // :contentReference[oaicite:6]{index=6}
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

  // Totals — prefer server-computed vested_value; fall back to FMV math
  const totals = useMemo(() => {
    let totalGranted = 0;
    let totalVested = 0;
    let totalUnvested = 0;
    let totalVestedValue = 0;
    let totalGrantedValue = 0;

    for (const g of grants) {
      const granted = toNumber(g.num_shares);
      const vested = toNumber(g.vested_shares);
      const unvested = "unvested_shares" in g
        ? toNumber(g.unvested_shares)
        : Math.max(granted - vested, 0);

      totalGranted += granted;
      totalVested += vested;
      totalUnvested += unvested;

      // prefer server vested_value
      let vValue = toNumber(g.vested_value, NaN);
      if (Number.isNaN(vValue)) {
        const fmv = toNumber(g.fmv ?? 0);
        vValue = vested * fmv;
      }
      totalVestedValue += vValue;

      const fmvAll = toNumber(g.fmv ?? 0);
      totalGrantedValue += granted * fmvAll;
    }
    return { totalGranted, totalVested, totalUnvested, totalVestedValue, totalGrantedValue };
  }, [grants]);

  if (loading) return <div className="p-6">Loading your dashboard…</div>;
  if (err) return <div className="p-6 text-red-600">{err}</div>;

  // If you want a company FMV in the header, use the first grant’s fmv as the current FMV:
  const headerFMV = currency(toNumber(grants[0]?.fmv ?? 0));

  return (
    <div className="p-6 space-y-6">
      {/* Header & Company Info */}
      <div className="bg-white rounded shadow p-4">
        <h1 className="text-2xl font-semibold">Welcome, {me?.name || "Employee"}</h1>
        <p className="text-gray-600">
          Company: <span className="font-medium">{me?.company}</span>
        </p>
        <p className="text-gray-600">Employee ID: {me?.unique_id}</p>
        <p className="text-gray-600">Company FMV: {headerFMV}</p>
      </div>

      {/* Summary */}
      <div className="bg-white rounded shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Summary</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-sm">
          <div className="p-3 rounded bg-gray-50">Granted Shares: {totals.totalGranted}</div>
          <div className="p-3 rounded bg-gray-50">Total Unvested: {totals.totalUnvested}</div>
          <div className="p-3 rounded bg-gray-50">Total Vested: {totals.totalVested}</div>
          <div className="p-3 rounded bg-gray-50">Vested Value: {currency(totals.totalVestedValue)}</div>
        </div>
      </div>

      {/* Grants */}
      {grants.map((g) => {
        const granted = toNumber(g.num_shares);
        const vested = toNumber(g.vested_shares);
        const unvested = "unvested_shares" in g ? toNumber(g.unvested_shares) : Math.max(granted - vested, 0);
        const fmv = toNumber(g.fmv ?? 0);

        return (
          <div key={g.id} className="bg-white rounded shadow p-4">
            <h3 className="font-semibold mb-2">Grant ID: <span className="">{g.id}</span></h3>
            <div className="text-sm space-y-1">
              <div>Granted: {fmtDate(g.grant_date)}</div>
              <div>Start Date: {fmtDate(g.vesting_start)}</div>
              <div>End Date: {fmtDate(g.vesting_end)}</div>
              <br />
              <div>Vested value: {currency(toNumber(g.vested_value ?? vested * fmv))}</div>
              <div>Vested shares: {vested}</div>
              <div>Unvested shares: {unvested}</div>
              <div>Strike Price: {g.strike_price ?? 'N/A'}</div>
              <div>Purchase Price: {g.purchase_price ?? 'N/A'}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}