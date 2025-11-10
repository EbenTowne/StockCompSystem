import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const API = import.meta.env.VITE_API_URL as string;

type CapRow = {
  unique_id: string;
  name: string;
  stock_class?: string;
  total_shares: number;
  ownership_pct: number;
};
type CapTableResponse = {
  market_cap: number;
  class_allocations?: { stock_class: string; allocated: number; remaining: number }[];
  rows: CapRow[];
};

// Donut chart slice type and colors (copied from CompanyMetrics)
type Slice = { label: string; value: number; color: string };

/** Indigo-forward palette */
const PIE_COLORS = [
  "#4f46e5", "#6366f1", "#4338ca", "#818cf8", "#a5b4fc",
  "#7c3aed", "#8b5cf6", "#3b82f6", "#1d4ed8", "#0ea5e9",
  "#06b6d4", "#0891b2",
];

const DonutChart = React.memo(function DonutChart({
  data,
  size = 220,
  thickness = 24,
  gap = 2,
  centerLabel,
}: {
  data: Slice[];
  size?: number;
  thickness?: number;
  gap?: number;
  centerLabel?: React.ReactNode;
}) {
  const total = Math.max(
    1,
    data.reduce((s, d) => s + (isFinite(d.value) ? d.value : 0), 0)
  );
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const gapLen = Math.min(gap, Math.max(0, circumference * 0.02));

  let cumulative = 0;
  const segments = data.map((d) => {
    const fraction = Math.max(0, d.value) / total;
    const rawLen = circumference * fraction;
    const length = Math.max(0, rawLen - gapLen);
    const dasharray = `${length} ${circumference - length}`;
    const dashoffset = circumference * 0.25 - cumulative;
    cumulative += length + gapLen;
    return { ...d, dasharray, dashoffset } as any;
  });

  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="Share allocation donut chart">
        <g transform={`translate(${size / 2}, ${size / 2})`}>
          <circle
            r={radius}
            cx={0}
            cy={0}
            fill="transparent"
            stroke="#eef2f7"
            strokeWidth={thickness}
            aria-hidden="true"
          />
          {segments.map((s, i) => (
            <circle
              key={i}
              r={radius}
              cx={0}
              cy={0}
              fill="transparent"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={s.dasharray}
              strokeDashoffset={s.dashoffset}
              strokeLinecap="round"
            >
              <title>{`${s.label}: ${s.value.toLocaleString()}`}</title>
            </circle>
          ))}
        </g>
      </svg>
      {centerLabel && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none select-none">
          <div className="text-center leading-tight text-sm">{centerLabel}</div>
        </div>
      )}
    </div>
  );
});

export default function CapTable() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [marketCap, setMarketCap] = useState<number>(0);
  const [rows, setRows] = useState<CapRow[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>("All");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const access = localStorage.getItem("accessToken");
    if (access) axios.defaults.headers.common["Authorization"] = `Bearer ${access}`;
    void load();
    return () => abortRef.current?.abort();
  }, []);

  async function load() {
    setLoading(true);
    setNote(null);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await axios.get<CapTableResponse>(`${API}/equity/cap-table/`, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      setMarketCap(res.data?.market_cap ?? 0);
      const fetchedRows = Array.isArray(res.data?.rows) ? res.data.rows : [];
      setRows(fetchedRows);

      // derive class list from response if provided, else from rows
      const fromResp = res.data?.class_allocations?.map((c: any) => c.stock_class) ?? null;
      if (Array.isArray(fromResp) && fromResp.length > 0) setClasses(["All", ...fromResp]);
      else {
        const uniq = Array.from(new Set(fetchedRows.map((r) => r.stock_class).filter((s): s is string => Boolean(s))));
        setClasses(["All", ...uniq]);
      }
    } catch (e: any) {
      if (!ctrl.signal.aborted) setNote(apiErr(e));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }

  const merged = useMemo(() => {
    // sum duplicates by unique_id
    const map = new Map<string, { name: string; total_shares: number; ownership_pct: number }>();
    for (const r of rows) {
      if (selectedClass && selectedClass !== "All" && r.stock_class !== selectedClass) continue;
      const cur = map.get(r.unique_id);
      if (!cur) map.set(r.unique_id, { name: r.name || "—", total_shares: r.total_shares || 0, ownership_pct: r.ownership_pct || 0 });
      else {
        cur.total_shares += r.total_shares || 0;
        cur.ownership_pct += r.ownership_pct || 0;
      }
    }
    const list = Array.from(map.entries()).map(([unique_id, v]) => ({ unique_id, name: v.name, total_shares: v.total_shares, ownership_pct: v.ownership_pct }));
    list.sort((a, b) => b.ownership_pct - a.ownership_pct || b.total_shares - a.total_shares || a.name.localeCompare(b.name));
    return list;
  }, [rows, selectedClass]);

  // formatting
  const fmtInt = (n: number) => (typeof n === "number" ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n) : "—");
  const fmtPct = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n) + "%";

  // pie data: top holders + unallocated (if marketCap provided)
  const pieData = useMemo(() => {
    const allocated = merged.reduce((s, r) => s + (r.total_shares || 0), 0);
    const unallocated = Math.max(0, (marketCap || 0) - allocated);

    const perHolder = merged.map((r) => ({ label: r.name ?? r.unique_id, value: Math.max(0, r.total_shares || 0) }));
    // only include holders with >0 shares
    const positive = perHolder.filter((p) => p.value > 0);
    positive.sort((a, b) => b.value - a.value);

    const TOP_N = 6;
    const top = positive.slice(0, TOP_N);
    const rest = positive.slice(TOP_N);
    const otherSum = rest.reduce((s, r) => s + r.value, 0);
    if (otherSum > 0) top.push({ label: "Other", value: otherSum });
    if (unallocated > 0) top.push({ label: "Unallocated", value: unallocated });

    // color assignment
    return top.map((d, i) => ({ ...d, color: PIE_COLORS[i % PIE_COLORS.length] }));
  }, [merged, marketCap]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-4 px-6">
      <div className="w-full">
        <section className="bg-white rounded-xl shadow-lg overflow-hidden w-full ring-1 ring-black/5">
          <div className="px-8 py-6 border-b border-gray-100">
            <div className="flex items-start md:items-center justify-between gap-6">
              <div className="min-w-0">
                <h1 className="text-3xl font-bold text-gray-900">Cap Table</h1>
                <p className="text-sm text-gray-600">Ownership breakdown for the current company</p>
              </div>
              <div className="shrink-0 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 border border-gray-200">
                Authorized shares: <span className="font-semibold">{fmtInt(marketCap)}</span>
              </div>
            </div>
            {/* Class filter selector */}
            <div className="mt-4 flex items-center gap-3">
              <label className="text-sm text-gray-600">Filter by class:</label>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-label="Filter by stock class"
              >
                {classes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {note && (
              <div className="mt-4 rounded-lg px-3 py-2 text-sm bg-red-50 text-red-800 border border-red-200">{note}</div>
            )}
          </div>

          <div className="px-8 pt-6">
            {loading ? (
              <div className="py-16 text-center text-gray-500">Loading…</div>
            ) : merged.length === 0 ? (
              <div className="py-16 text-center text-gray-500">No cap table data found.</div>
            ) : (
              <div className="mt-2 grid grid-cols-1 md:grid-cols-[minmax(240px,280px)_minmax(0,1fr)] gap-7 items-start">
                <div className="flex justify-center md:justify-start">
                  <DonutChart
                    data={pieData}
                    size={220}
                    thickness={24}
                    gap={2}
                    centerLabel={
                      <div className="leading-tight text-center">
                        <div className="text-[10px] text-gray-500">Unallocated</div>
                        <div className="font-semibold text-sm">{fmtInt(Math.max(0, (marketCap || 0) - merged.reduce((s, r) => s + (r.total_shares || 0), 0)))}</div>
                      </div>
                    }
                  />
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-[14px]">
                    <thead className="bg-white border-b border-gray-100">
                      <tr>
                        <th className="px-1.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 w-10 text-center">#</th>
                        <th className="px-1.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 text-left">Holder</th>
                        <th className="px-1.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">ID</th>
                        <th className="px-1.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 text-right">Total Shares</th>
                        <th className="px-1.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 text-right">% Ownership</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {merged.map((r, i) => (
                        <tr key={r.unique_id} className="transition-colors hover:bg-gray-50/60">
                          <td className="px-1.5 py-2.5 text-center text-gray-500">{i + 1}</td>
                          <td className="px-1.5 py-2.5 text-left">
                            <button
                              onClick={() =>
                                nav(`/dashboard/grants?id=${encodeURIComponent(r.unique_id)}`)
                              }
                              className="font-medium text-gray-900 truncate max-w-[420px] text-left w-full"
                              aria-label={`Manage grants for ${r.name || r.unique_id}`}
                            >
                              {r.name || "—"}
                            </button>
                          </td>
                          <td className="px-1.5 py-2.5">
                            <span className="inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] bg-gray-100 text-gray-700">{r.unique_id}</span>
                          </td>
                          <td className="px-1.5 py-2.5 text-right">{fmtInt(r.total_shares)}</td>
                          <td className="px-1.5 py-2.5 text-right">{fmtPct(r.ownership_pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="px-8 pb-8 pt-6 flex items-center justify-between border-t border-gray-100">
            <div className="text-sm text-gray-500">Showing <span className="font-medium">{merged.length}</span> {merged.length === 1 ? "holder" : "holders"}</div>
            <div className="flex gap-3">
              <button onClick={load} className="px-3 py-2 rounded-lg border text-sm hover:bg-gray-50">Reload</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

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
