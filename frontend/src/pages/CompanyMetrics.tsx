import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL as string; // e.g. "http://localhost:8000/api"

/** -------------------- API paths (relative to API) -------------------- */
const COMPANY_BASE = "/company/";
const COMPANY_FINANCIALS = "/company/financials/";
const CLASSES_BASE = "/equity/classes/";
const SERIES_BASE = "/equity/series/";

/** -------------------- Types -------------------- */
type FinancialRow = {
  year: number | "";
  revenue: string | number | null;
  net_income: string | number | null;
};

type CompanyForm = {
  name?: string;
  total_authorized_shares: string;
  current_fmv: string;
  current_market_value: string;
  volatility: string;
  risk_free_rate: string;
  financials: FinancialRow[];
};

type EquityClass = {
  id: number | string;
  name: string;
  share_type?: "COMMON" | "PREFERRED" | null; // read-only (inferred from series)
  total_class_shares?: number | string | null;
  is_archived?: boolean;
  series?: { id: number; name: string; share_type: "COMMON" | "PREFERRED" | null };
};

type EquitySeries = {
  id: number | string;
  name: string;
  share_type: "COMMON" | "PREFERRED" | null;
  created_at?: string;
  is_archived?: boolean;
};

/** -------------------- Formatting Helpers -------------------- */
function sanitizeNumberInput(v: string) {
  const cleaned = v.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) return cleaned;
  return parts[0] + "." + parts.slice(1).join("").replace(/\./g, "");
}
function formatWithCommas(n: string) {
  if (n === "") return "";
  if (n === ".") return "0.";
  const [int, dec] = n.split(".");
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec !== undefined ? `${intFormatted}.${dec}` : intFormatted;
}
function unformatNumberString(v: string) {
  const s = v.replace(/,/g, "");
  if (s === "" || s === ".") return "0";
  return s;
}
function formatSharesDisplay(v: string) {
  const digits = v.replace(/\D/g, "");
  return digits === "" ? "0" : digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function percentDigitsToDecimalString(v: string) {
  const digits = v.replace(/\D/g, "");
  if (!digits) return "0";
  const num = Number(digits) / 100;
  return String(num);
}
function toShareNumber(input: number | string | null | undefined): number {
  if (input == null || input === "") return 0;
  if (typeof input === "number") return input;
  return Number(String(input).replace(/,/g, "")) || 0;
}
function extractErrorMessage(err: any): string {
  if (!err?.response?.data) return "Unexpected error occurred.";
  const data = err.response.data;
  if (typeof data === "string") return data;
  if (data.detail) return data.detail;
  if (data.error) return data.error;
  try {
    const flat = Object.entries(data)
      .map(([k, v]) => {
        if (Array.isArray(v)) return `${k}: ${v.join(", ")}`;
        if (typeof v === "string") return `${k}: ${v}`;
        return `${k}: ${JSON.stringify(v)}`;
      })
      .join(" ");
    if (flat.trim()) return flat;
  } catch {}
  return "An unknown error occurred.";
}

/** -------------------- Donut (Pie) Chart -------------------- */
type Slice = { label: string; value: number; color: string };

function DonutChart({
  data,
  size = 160,
  thickness = 22,
  centerLabel,
}: {
  data: Slice[];
  size?: number;
  thickness?: number;
  centerLabel?: React.ReactNode;
}) {
  const total = Math.max(1, data.reduce((s, d) => s + (isFinite(d.value) ? d.value : 0), 0));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulative = 0;
  const segments = data.map((d) => {
    const fraction = Math.max(0, d.value) / total;
    const length = circumference * fraction;
    const dasharray = `${length} ${circumference - length}`;
    const dashoffset = circumference * 0.25 - cumulative; // start at 12 o'clock
    cumulative += length;
    return { ...d, dasharray, dashoffset };
  });

  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`translate(${size / 2}, ${size / 2})`}>
          <circle r={radius} cx={0} cy={0} fill="transparent" stroke="#eef2f7" strokeWidth={thickness} />
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
            />
          ))}
        </g>
      </svg>
      {centerLabel && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center text-sm">{centerLabel}</div>
        </div>
      )}
    </div>
  );
}
const PIE_COLORS = ["#111827", "#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#059669", "#ea580c", "#9333ea"];

/** -------------------- Component -------------------- */
export default function CompanyMetrics() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [form, setForm] = useState<CompanyForm>({
    total_authorized_shares: "0",
    current_fmv: "0",
    current_market_value: "0",
    volatility: "0",
    risk_free_rate: "0",
    financials: [],
  });

  const [classes, setClasses] = useState<EquityClass[]>([]);
  const [series, setSeries] = useState<EquitySeries[]>([]);

  // Collapsible toggles (start CLOSED by default)
  const [openSeries, setOpenSeries] = useState(false);
  const [openClasses, setOpenClasses] = useState(false);
  const [openFinancials, setOpenFinancials] = useState(false);

  // Modals
  const [showClassModal, setShowClassModal] = useState(false);
  const [newClass, setNewClass] = useState<{ name: string; total_class_shares: string; series_id: string }>({
    name: "",
    total_class_shares: "",
    series_id: "",
  });
  const [showSeriesModal, setShowSeriesModal] = useState(false);
  const [newSeries, setNewSeries] = useState<{ name: string; share_type: "COMMON" | "PREFERRED" | null }>({
    name: "",
    share_type: null,
  });

  /** Auth header + initial load */
  useEffect(() => {
    const access = localStorage.getItem("accessToken");
    if (access) axios.defaults.headers.common["Authorization"] = `Bearer ${access}`;
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setNote(null);
    try {
      const [companyRes, classRes, seriesRes, finRes] = await Promise.all([
        axios.get(`${API}${COMPANY_BASE}`),
        axios.get(`${API}${CLASSES_BASE}`),
        axios.get(`${API}${SERIES_BASE}`),
        axios.get(`${API}${COMPANY_FINANCIALS}`).catch(() => ({ data: null } as any)),
      ]);

      const company = companyRes.data || {};
      const next: CompanyForm = {
        name: company?.name,
        total_authorized_shares:
          company?.total_authorized_shares != null ? String(company.total_authorized_shares) : "0",
        current_fmv:
          company?.current_fmv != null && company.current_fmv !== ""
            ? formatWithCommas(sanitizeNumberInput(String(company.current_fmv)))
            : "0",
        current_market_value:
          company?.current_market_value != null && company.current_market_value !== ""
            ? formatWithCommas(sanitizeNumberInput(String(company.current_market_value)))
            : "0",
        volatility:
          company?.volatility != null && company.volatility !== ""
            ? String(Math.round(Number(company.volatility) * 100))
            : "0",
        risk_free_rate:
          company?.risk_free_rate != null && company.risk_free_rate !== ""
            ? String(Math.round(Number(company.risk_free_rate) * 100))
            : "0",
        financials: Array.isArray(company?.financials)
          ? company.financials.map((r: any) => ({ year: r.year ?? "", revenue: r.revenue ?? null, net_income: r.net_income ?? null }))
          : [],
      };

      const recent = finRes?.data;
      if (recent && Array.isArray(recent.financials)) {
        const seen = new Set(next.financials.map((r) => r.year));
        const extra: FinancialRow[] = recent.financials
          .filter((r: any) => !seen.has(r.year))
          .map((r: any) => ({ year: r.year ?? "", revenue: r.revenue ?? null, net_income: r.net_income ?? null }));
        next.financials = [...next.financials, ...extra];
      }

      setForm(next);
      setClasses(Array.isArray(classRes.data) ? classRes.data : []);
      setSeries(Array.isArray(seriesRes.data) ? seriesRes.data : []);
    } catch (err: any) {
      setNote({ type: "err", text: extractErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }

  /** Allocation math for donut */
  const authorizedShares = useMemo(
    () => Number(String(form.total_authorized_shares).replace(/,/g, "")) || 0,
    [form.total_authorized_shares]
  );
  const allocatedShares = useMemo(
    () => classes.reduce((sum, c) => sum + toShareNumber(c.total_class_shares), 0),
    [classes]
  );
  const remainingShares = Math.max(0, authorizedShares - allocatedShares);

  // Build slices incl. Unallocated
  const pieData: Slice[] = useMemo(() => {
    const perClass = classes
      .filter((c) => toShareNumber(c.total_class_shares) > 0)
      .map((c, idx) => ({
        label: c.name,
        value: toShareNumber(c.total_class_shares),
        color: PIE_COLORS[idx % PIE_COLORS.length],
      }));
    const unallocated = Math.max(0, authorizedShares - allocatedShares);
    if (authorizedShares > 0 && unallocated > 0) {
      perClass.push({ label: "Unallocated", value: unallocated, color: "#9ca3af" });
    }
    return perClass;
  }, [classes, authorizedShares, allocatedShares]);

  /** Percent helper for legend */
  const totalForPct = Math.max(1, pieData.reduce((s, p) => s + p.value, 0));
  const percent = (n: number) => Math.round((n / totalForPct) * 100);

  /** Form helpers */
  function updateField<K extends keyof CompanyForm>(key: K, value: CompanyForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function updateFinancial(i: number, key: keyof FinancialRow, value: any) {
    setForm((f) => {
      const copy = [...f.financials];
      copy[i] = { ...copy[i], [key]: value };
      return { ...f, financials: copy };
    });
  }
  function addRow() {
    setForm((f) => ({ ...f, financials: [{ year: "", revenue: null, net_income: null }, ...f.financials] }));
  }
  function removeRow(i: number) {
    setForm((f) => {
      const copy = [...f.financials];
      copy.splice(i, 1);
      return { ...f, financials: copy };
    });
  }

  /** Save company */
  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNote(null);
    try {
      const payload = {
        total_authorized_shares:
          form.total_authorized_shares.trim() === "" ? 0 : Number(form.total_authorized_shares.replace(/,/g, "")),
        current_fmv: unformatNumberString(form.current_fmv),
        current_market_value: unformatNumberString(form.current_market_value),
        volatility: percentDigitsToDecimalString(form.volatility),
        risk_free_rate: percentDigitsToDecimalString(form.risk_free_rate),
        financials: form.financials
          .filter((r) => r.year !== "")
          .map((r) => ({ year: Number(r.year), revenue: r.revenue === "" ? null : r.revenue, net_income: r.net_income === "" ? null : r.net_income })),
      };

      const res = await axios.put(`${API}${COMPANY_BASE}`, payload);
      const updated = res.data;

      setNote({ type: "ok", text: "Company metrics saved successfully." });
      setForm((f) => ({
        ...f,
        total_authorized_shares: String(payload.total_authorized_shares || "0"),
        current_fmv: formatWithCommas(sanitizeNumberInput(String(payload.current_fmv))),
        current_market_value: formatWithCommas(sanitizeNumberInput(String(payload.current_market_value))),
        volatility: String(Math.round(Number(payload.volatility || "0") * 100)),
        risk_free_rate: String(Math.round(Number(payload.risk_free_rate || "0") * 100)),
        financials: Array.isArray(updated?.financials)
          ? updated.financials.map((r: any) => ({ year: r.year ?? "", revenue: r.revenue ?? null, net_income: r.net_income ?? null }))
          : f.financials,
      }));
    } catch (err: any) {
      setNote({ type: "err", text: extractErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  /** Create/Delete entities (needed by modals) */
  async function createClass() {
    if (!newClass.name.trim()) return;
    if (!newClass.total_class_shares.trim()) {
      setNote({ type: "err", text: "Total class shares is required." });
      return;
    }
    if (!newClass.series_id) {
      setNote({ type: "err", text: "Series is required for every class." });
      return;
    }
    try {
      const payload: any = {
        name: newClass.name.trim(),
        total_class_shares: newClass.total_class_shares === "" ? null : Number(newClass.total_class_shares),
        series_id: Number(newClass.series_id),
      };
      const res = await axios.post(`${API}${CLASSES_BASE}`, payload);
      setClasses((prev) => [res.data, ...prev]);
      setNewClass({ name: "", total_class_shares: "", series_id: "" });
      setShowClassModal(false);
      setNote({ type: "ok", text: "Class added." });
    } catch (err: any) {
      setNote({ type: "err", text: extractErrorMessage(err) });
    }
  }

  async function createSeries() {
    if (!newSeries.name.trim()) return;
    if (!newSeries.share_type) {
      setNote({ type: "err", text: "Select a share type for the series." });
      return;
    }
    try {
      const res = await axios.post(`${API}${SERIES_BASE}`, {
        name: newSeries.name.trim(),
        share_type: newSeries.share_type,
      });
      setSeries((prev) => [res.data, ...prev]);
      setNewSeries({ name: "", share_type: null });
      setShowSeriesModal(false);
      setNote({ type: "ok", text: "Series added." });
    } catch (err: any) {
      setNote({ type: "err", text: extractErrorMessage(err) });
    }
  }

  async function deleteClass(id: string | number) {
    try {
      await axios.delete(`${API}${CLASSES_BASE}${id}/`);
      setClasses((prev) => prev.filter((c) => String(c.id) !== String(id)));
      setNote({ type: "ok", text: "Class deleted." });
    } catch (err: any) {
      setNote({ type: "err", text: extractErrorMessage(err) });
    }
  }

  async function deleteSeries(id: string | number) {
    const numLinked = classes.filter((c) => c.series?.id === Number(id)).length;
    const proceed = confirm(
      numLinked > 0
        ? `This series has ${numLinked} linked class(es). Deleting the series will also delete those classes. Continue?`
        : "Delete this series?"
    );
    if (!proceed) return;
    try {
      await axios.delete(`${API}${SERIES_BASE}${id}/`);
      setSeries((prev) => prev.filter((s) => String(s.id) !== String(id)));
      if (numLinked > 0) setClasses((prev) => prev.filter((c) => c.series?.id !== Number(id)));
      setNote({ type: "ok", text: "Series deleted." });
    } catch (err: any) {
      setNote({ type: "err", text: extractErrorMessage(err) });
    }
  }

  function displaySeriesType(t: "COMMON" | "PREFERRED" | null | undefined) {
    if (!t) return "—";
    return t === "COMMON" ? "Common" : "Preferred";
  }

  if (loading)
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-xl shadow-lg overflow-hidden p-8 text-center text-gray-700">
            Loading company data…
          </div>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Trimmed padding since header is removed */}
          <div className="px-8 py-8">
            {note && (
              <div
                className={`rounded-lg border p-3 text-sm mb-6 ${
                  note.type === "ok" ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                {note.text}
              </div>
            )}

            {/* ===== Top row: Metrics (left) + Share Allocation (right) ===== */}
            <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Company Metrics */}
              <div className="pt-2">
                <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">Company Metrics</h2>
                  </div>

                  <form onSubmit={onSave} className="space-y-6">
                    {/* Row 1 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Current Market Value */}
                      <div>
                        <label className="block text-sm mb-1 text-gray-700">Current Market Value</label>
                        <div className="relative">
                          <input
                            className="w-full border rounded-lg pl-10 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formatWithCommas(sanitizeNumberInput(form.current_market_value))}
                            onChange={(e) => updateField("current_market_value", sanitizeNumberInput(e.target.value))}
                            onBlur={(e) => updateField("current_market_value", sanitizeNumberInput(e.target.value) || "0")}
                            placeholder="0"
                            inputMode="decimal"
                          />
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">$</span>
                        </div>
                      </div>

                      {/* Total Authorized Shares */}
                      <div>
                        <div className="flex items-center justify-between">
                          <label className="block text-sm mb-1 text-gray-700">Total Authorized Shares</label>
                          <span className="text-xs text-gray-600">
                            Remaining: <b>{remainingShares.toLocaleString()}</b>
                          </span>
                        </div>
                        <input
                          className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          value={formatSharesDisplay(form.total_authorized_shares)}
                          onChange={(e) => updateField("total_authorized_shares", e.target.value.replace(/\D/g, ""))}
                          onBlur={(e) => updateField("total_authorized_shares", e.target.value.replace(/\D/g, "") || "0")}
                          placeholder="0"
                          inputMode="numeric"
                        />
                      </div>
                    </div>

                    {/* Row 2 */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {/* FMV */}
                      <div>
                        <label className="block text-sm mb-1 text-gray-700">FMV</label>
                        <div className="relative">
                          <input
                            className="w-full border rounded-lg pl-10 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formatWithCommas(sanitizeNumberInput(form.current_fmv))}
                            onChange={(e) => updateField("current_fmv", sanitizeNumberInput(e.target.value))}
                            onBlur={(e) => updateField("current_fmv", sanitizeNumberInput(e.target.value) || "0")}
                            placeholder="0"
                            inputMode="decimal"
                          />
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">$</span>
                        </div>
                      </div>

                      {/* Volatility */}
                      <div>
                        <label className="block text-sm mb-1 text-gray-700">Volatility</label>
                        <div className="relative">
                          <input
                            className="w-full border rounded-lg pr-10 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={form.volatility.replace(/\D/g, "") || "0"}
                            onChange={(e) => updateField("volatility", e.target.value.replace(/\D/g, ""))}
                            onBlur={(e) => updateField("volatility", e.target.value.replace(/\D/g, "") || "0")}
                            placeholder="0"
                            inputMode="numeric"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">%</span>
                        </div>
                      </div>

                      {/* Risk Free Rate */}
                      <div>
                        <label className="block text-sm mb-1 text-gray-700">Risk Free Rate</label>
                        <div className="relative">
                          <input
                            className="w-full border rounded-lg pr-10 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={form.risk_free_rate.replace(/\D/g, "") || "0"}
                            onChange={(e) => updateField("risk_free_rate", e.target.value.replace(/\D/g, ""))}
                            onBlur={(e) => updateField("risk_free_rate", e.target.value.replace(/\D/g, "") || "0")}
                            placeholder="0"
                            inputMode="numeric"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">%</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-1">
                      <button
                        type="submit"
                        disabled={saving}
                        className="bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                      >
                        {saving ? "Saving…" : "Save Changes"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>

              {/* Share Allocation */}
              <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-medium text-gray-900">Share Allocation</h3>
                  {authorizedShares > 0 && (
                    <span className="text-xs text-gray-600">
                      Allocated: <b>{allocatedShares.toLocaleString()}</b>
                    </span>
                  )}
                </div>

                {authorizedShares <= 0 ? (
                  <p className="text-sm text-gray-600">
                    Set <b>Total Authorized Shares</b> to see allocation.
                  </p>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-10 sm:flex-row sm:justify-center mt-6 mb-2">
                    {/* Chart */}
                    <div className="flex justify-center">
                      <DonutChart
                        data={pieData}
                        size={200}
                        thickness={22}
                        centerLabel={
                          <div className="leading-tight">
                            <div className="text-[10px] text-gray-500">Authorized</div>
                            <div className="font-semibold text-sm">{authorizedShares.toLocaleString()}</div>
                          </div>
                        }
                      />
                    </div>

                    {/* Legend */}
                    <div className="min-w-[260px]">
                      <ul className="space-y-1.5">
                        {pieData.map((s, i) => (
                          <li key={i} className="flex items-center justify-between gap-3 text-sm">
                            <span className="flex items-center gap-2 min-w-0">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
                                style={{ background: s.color }}
                              />
                              <span className="truncate" title={s.label}>
                                {s.label}
                              </span>
                            </span>
                            <span className="shrink-0 tabular-nums text-right">
                              {s.value.toLocaleString()}{" "}
                              <span className="ml-1 inline-block rounded-full border px-1.5 py-0.5 text-[11px] text-gray-700">
                                {percent(s.value)}%
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* ===== Series / Rounds (Collapsible - closed by default) ===== */}
            <section className="mt-6 bg-white rounded-lg">
              <div className="border rounded-lg bg-white">
                <button
                  type="button"
                  onClick={() => setOpenSeries((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3"
                >
                  <span className="text-lg font-medium">Series / Rounds</span>
                  <span className="text-gray-600">{openSeries ? "▾" : "▸"}</span>
                </button>

                <div
                  className={`overflow-hidden transition-[max-height] duration-300 ${
                    openSeries ? "max-h-[2000px]" : "max-h-0"
                  }`}
                >
                  <div className="px-4 pb-4">
                    <div className="flex items-center justify-end mb-2">
                      <button
                        type="button"
                        className="border rounded-lg px-3 py-1 hover:bg-gray-50"
                        onClick={() => setShowSeriesModal(true)}
                      >
                        + Add Series
                      </button>
                    </div>

                    <div className="space-y-3">
                      {series.length === 0 && (
                        <div className="text-gray-500 text-sm border rounded-lg p-3">
                          No series configured. Click “Add Series”.
                        </div>
                      )}

                      {series.map((s) => (
                        <div key={String(s.id)} className="grid grid-cols-12 gap-2 items-end border rounded-lg p-3">
                          <div className="col-span-12 sm:col-span-7">
                            <div className="text-xs text-gray-600 mb-1">Name</div>
                            <div className="font-medium">{s.name}</div>
                          </div>
                          <div className="col-span-6 sm:col-span-3">
                            <div className="text-xs text-gray-600 mb-1">Share Type</div>
                            <div>{displaySeriesType(s.share_type)}</div>
                          </div>
                          <div className="col-span-6 sm:col-span-2 flex sm:justify-end">
                            <button
                              type="button"
                              className="w-full sm:w-auto border rounded-lg px-3 py-2 hover:bg-gray-50"
                              onClick={() => {
                                const linked = classes.filter((c) => c.series?.id === Number(s.id)).length;
                                const ok = confirm(
                                  linked > 0
                                    ? `This series has ${linked} linked class(es). Deleting the series will also delete those classes. Continue?`
                                    : `Delete series "${s.name}"?`
                                );
                                if (ok) deleteSeries(s.id);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ===== Classes (Collapsible - closed by default) ===== */}
            <section className="mt-6">
              <div className="border rounded-lg bg-white">
                <button
                  type="button"
                  onClick={() => setOpenClasses((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3"
                >
                  <span className="text-lg font-medium">Classes</span>
                  <span className="text-gray-600">{openClasses ? "▾" : "▸"}</span>
                </button>

                <div
                  className={`overflow-hidden transition-[max-height] duration-300 ${
                    openClasses ? "max-h-[2000px]" : "max-h-0"
                  }`}
                >
                  <div className="px-4 pb-4">
                    <div className="flex items-center justify-end mb-2">
                      <button
                        type="button"
                        className="border rounded-lg px-3 py-1 hover:bg-gray-50"
                        onClick={() => setShowClassModal(true)}
                      >
                        + Add Class
                      </button>
                    </div>

                    <div className="space-y-3">
                      {classes.length === 0 && (
                        <div className="text-gray-500 text-sm border rounded-lg p-3">
                          No classes configured. Click “Add Class”.
                        </div>
                      )}

                      {classes.map((c) => (
                        <div key={String(c.id)} className="grid grid-cols-12 gap-2 items-end border rounded-lg p-3">
                          <div className="col-span-12 sm:col-span-5">
                            <div className="text-xs text-gray-600 mb-1">Name</div>
                            <div className="font-medium">{c.name}</div>
                          </div>
                          <div className="col-span-6 sm:col-span-3">
                            <div className="text-xs text-gray-600 mb-1">Type</div>
                            <div>{(c.share_type ?? c.series?.share_type) === "COMMON" ? "Common" : "Preferred"}</div>
                          </div>
                          <div className="col-span-6 sm:col-span-2">
                            <div className="text-xs text-gray-600 mb-1">Total Class Shares</div>
                            <div>{c.total_class_shares ?? "—"}</div>
                          </div>
                          <div className="col-span-12 sm:col-span-2 flex sm:justify-end">
                            <button
                              type="button"
                              className="w-full sm:w-auto border rounded-lg px-3 py-2 hover:bg-gray-50"
                              onClick={() => {
                                if (confirm(`Delete class "${c.name}"?`)) deleteClass(c.id);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                          {c.series?.name && (
                            <div className="col-span-12 text-xs text-gray-600">
                              Linked Series: {c.series.name} ({displaySeriesType(c.series.share_type)})
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Company Financials Section */}
            <section className="mt-6">
              <div className="border rounded-lg bg-white">
                <button
                  type="button"
                  onClick={() => setOpenFinancials((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3"
                >
                  <span className="text-lg font-medium">Company Financials</span>
                  <span className="text-gray-600">{openFinancials ? "▾" : "▸"}</span>
                </button>

                <div
                  className={`overflow-hidden transition-[max-height] duration-300 ${
                    openFinancials ? "max-h-[2000px]" : "max-h-0"
                  }`}
                >
                  <div className="px-4 pb-4">
                    <div className="flex items-center justify-end mb-2">
                      <button type="button" className="border rounded-lg px-3 py-1 hover:bg-gray-50" onClick={addRow}>
                        + Add Year
                      </button>
                    </div>

                    <div className="space-y-3">
                      {form.financials.length === 0 && (
                        <div className="text-gray-500 text-sm">No financial rows yet. Click “Add Year”.</div>
                      )}
                      {form.financials.map((row, i) => (
                        <div key={i} className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-12 sm:col-span-2">
                            <label className="block text-sm mb-1">Year</label>
                            <input
                              type="number"
                              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              value={row.year}
                              onChange={(e) =>
                                updateFinancial(i, "year", e.target.value === "" ? "" : Number(e.target.value))
                              }
                              min={1900}
                            />
                          </div>

                          {/* Revenue with $ */}
                          <div className="col-span-12 sm:col-span-4">
                            <label className="block text-sm mb-1">Revenue (USD)</label>
                            <div className="relative">
                              <input
                                type="number"
                                step="0.01"
                                className="w-full border rounded-lg pl-10 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={row.revenue ?? ""}
                                onChange={(e) => updateFinancial(i, "revenue", e.target.value)}
                              />
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                                $
                              </span>
                            </div>
                          </div>

                          {/* Net Income with $ */}
                          <div className="col-span-12 sm:col-span-4">
                            <label className="block text-sm mb-1">Net Income (USD)</label>
                            <div className="relative">
                              <input
                                type="number"
                                step="0.01"
                                className="w-full border rounded-lg pl-10 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={row.net_income ?? ""}
                                onChange={(e) => updateFinancial(i, "net_income", e.target.value)}
                              />
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                                $
                              </span>
                            </div>
                          </div>

                          <div className="col-span-12 sm:col-span-2">
                            <button
                              type="button"
                              className="w-full border rounded-lg px-3 py-2 hover:bg-gray-50"
                              onClick={() => removeRow(i)}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* -------------------- Modals -------------------- */}
            {showClassModal && (
              <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
                <div className="bg-white rounded-xl p-4 w-full max-w-md shadow-lg">
                  <h3 className="text-lg font-semibold mb-3">Add Class</h3>
                  <div className="space-y-3">
                    <label className="block">
                      <span className="block text-sm mb-1">Name</span>
                      <input
                        className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={newClass.name}
                        onChange={(e) => setNewClass((s) => ({ ...s, name: e.target.value }))}
                      />
                    </label>

                    <label className="block">
                      <span className="block text-sm mb-1">Total Class Shares</span>
                      <input
                        type="number"
                        min={0}
                        className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={newClass.total_class_shares}
                        onChange={(e) => setNewClass((s) => ({ ...s, total_class_shares: e.target.value }))}
                        placeholder="e.g. 1000000"
                      />
                    </label>

                    <label className="block">
                      <span className="block text-sm mb-1">Series (required)</span>
                      <select
                        className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={newClass.series_id}
                        onChange={(e) => setNewClass((s) => ({ ...s, series_id: e.target.value }))}
                        required
                      >
                        <option value="">Select a series…</option>
                        {series.map((s) => (
                          <option key={String(s.id)} value={String(s.id)}>
                            {s.name} ({displaySeriesType(s.share_type)})
                          </option>
                        ))}
                      </select>
                    </label>

                    {newClass.series_id && (
                      <div className="text-sm text-gray-600">
                        This class will be type{" "}
                        <b>
                          {series.find((s) => String(s.id) === newClass.series_id)?.share_type === "COMMON"
                            ? "Common"
                            : "Preferred"}
                        </b>{" "}
                        based on the linked series.
                      </div>
                    )}
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="border rounded-lg px-3 py-1 hover:bg-gray-50" onClick={() => setShowClassModal(false)}>
                      Cancel
                    </button>
                    <button className="px-3 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700" onClick={createClass}>
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showSeriesModal && (
              <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
                <div className="bg-white rounded-xl p-4 w-full max-w-md shadow-lg">
                  <h3 className="text-lg font-semibold mb-3">Add Series</h3>
                  <div className="space-y-3">
                    <label className="block">
                      <span className="block text-sm mb-1">Name</span>
                      <input
                        className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={newSeries.name}
                        onChange={(e) => setNewSeries((s) => ({ ...s, name: e.target.value }))}
                      />
                    </label>

                    <label className="block">
                      <span className="block text-sm mb-1">Share Type</span>
                      <select
                        className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={newSeries.share_type ?? ""}
                        onChange={(e) => {
                          const val = e.target.value === "" ? null : (e.target.value as "COMMON" | "PREFERRED");
                          setNewSeries((s) => ({ ...s, share_type: val }));
                        }}
                        required
                      >
                        <option value="" disabled>
                          Select share type…
                        </option>
                        <option value="COMMON">Common</option>
                        <option value="PREFERRED">Preferred</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="border rounded-lg px-3 py-1 hover:bg-gray-50" onClick={() => setShowSeriesModal(false)}>
                      Cancel
                    </button>
                    <button className="px-3 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700" onClick={createSeries}>
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}