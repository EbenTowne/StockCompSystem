import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL as string; // e.g. "http://localhost:8000/api"

// ---------- API paths ----------
const COMPANY_BASE = "/company/";
const COMPANY_FINANCIALS = "/company/financials/"; // list + POST; DELETE /company/financials/<year>/
const CLASSES_BASE = "/equity/classes/";
const SERIES_BASE = "/equity/series/";

// ---------- Tiny session cache (60s TTL) ----------
const CACHE_TTL_MS = 60_000;
function ssGet<T>(k: string): T | null {
  try {
    const raw = sessionStorage.getItem(k);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() - obj.t > CACHE_TTL_MS) return null;
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

// ---------- Types ----------
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
  share_type?: "COMMON" | "PREFERRED" | null;
  total_class_shares?: number | string | null;
  // read-only from API if present
  shares_allocated?: number | string | null;
  shares_remaining?: number | string | null;
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

// ---------- Helpers ----------
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

// ---------- Donut Chart ----------
type Slice = { label: string; value: number; color: string };

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
    return { ...d, dasharray, dashoffset };
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

/** Indigo-forward palette */
const PIE_COLORS = [
  "#4f46e5", "#6366f1", "#4338ca", "#818cf8", "#a5b4fc",
  "#7c3aed", "#8b5cf6", "#3b82f6", "#1d4ed8", "#0ea5e9",
  "#06b6d4", "#0891b2",
];

// ---------- Component ----------
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

  // dropdowns CLOSED by default
  const [openSeries, setOpenSeries] = useState(false);
  const [openClasses, setOpenClasses] = useState(false);
  const [openFinancials, setOpenFinancials] = useState(false);

  // modals
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

  // abort control for in-flight loads
  const abortRef = useRef<AbortController | null>(null);

  // ---------- Load ----------
  useEffect(() => {
    const access = localStorage.getItem("accessToken");
    if (access) axios.defaults.headers.common["Authorization"] = `Bearer ${access}`;
    loadAll();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    setLoading(true);
    setNote(null);

    // 1) warm up with cache (non-blocking)
    const cacheKey = "metrics-init";
    const cached = ssGet<{
      company: any;
      classes: EquityClass[];
      series: EquitySeries[];
      financials?: any;
    }>(cacheKey);

    if (cached) {
      const company = cached.company || {};
      startTransition(() => {
        setForm({
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
            ? company.financials.map((r: any) => ({
                year: r.year ?? "",
                revenue: r.revenue ?? null,
                net_income: r.net_income ?? null,
              }))
            : [],
        });
        setClasses(cached.classes || []);
        setSeries(cached.series || []);
      });
    }

    // 2) fetch fresh with abort support
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const [companyRes, classRes, seriesRes, finRes] = await Promise.all([
        axios.get(`${API}${COMPANY_BASE}`, { signal: ctrl.signal }),
        axios.get(`${API}${CLASSES_BASE}`, { signal: ctrl.signal }),
        axios.get(`${API}${SERIES_BASE}`, { signal: ctrl.signal }),
        axios.get(`${API}${COMPANY_FINANCIALS}`, { signal: ctrl.signal }).catch(() => ({ data: null } as any)),
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
          ? company.financials.map((r: any) => ({
              year: r.year ?? "",
              revenue: r.revenue ?? null,
              net_income: r.net_income ?? null,
            }))
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

      const classList: EquityClass[] = Array.isArray(classRes.data) ? classRes.data : [];
      const seriesList: EquitySeries[] = Array.isArray(seriesRes.data) ? seriesRes.data : [];

      startTransition(() => {
        setForm(next);
        setClasses(classList);
        setSeries(seriesList);
      });

      ssSet(cacheKey, {
        company: companyRes.data,
        classes: classList,
        series: seriesList,
        financials: finRes?.data,
      });
    } catch (err: any) {
      if (ctrl.signal.aborted) return;
      setNote({ type: "err", text: extractErrorMessage(err) });
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }

  // ---------- Allocation ----------
  const authorizedShares = useMemo(
    () => Number(String(form.total_authorized_shares).replace(/,/g, "")) || 0,
    [form.total_authorized_shares]
  );

  // Sum allocations (prefer API's shares_allocated; fallback to class totals)
  const allocatedShares = useMemo(
    () =>
      classes.reduce((sum, c) => {
        const allocFromApi = toShareNumber((c as any).shares_allocated);
        return sum + (allocFromApi > 0 ? allocFromApi : toShareNumber(c.total_class_shares));
      }, 0),
    [classes]
  );

  const remainingShares = Math.max(0, authorizedShares - allocatedShares);

  // Group small slices into "Other" and sort desc
  const pieData: Slice[] = useMemo(() => {
    const perClass = classes
      .filter((c) => toShareNumber(c.total_class_shares) > 0)
      .map((c) => ({
        label: c.name,
        value: toShareNumber(c.total_class_shares),
      }));

    // include "Unallocated" as a slice
    const unallocated = Math.max(0, authorizedShares - allocatedShares);
    if (authorizedShares > 0 && unallocated > 0) {
      perClass.push({ label: "Unallocated", value: unallocated });
    }

    // sort by value desc
    perClass.sort((a, b) => b.value - a.value);

    const TOP_N = 6;
    const top = perClass.slice(0, TOP_N);
    const rest = perClass.slice(TOP_N);
    const otherSum = rest.reduce((s, r) => s + r.value, 0);
    if (otherSum > 0) top.push({ label: "Other", value: otherSum });

    return top.map((d, i) => ({
      ...d,
      color: d.label === "Unallocated" ? "#9ca3af" : d.label === "Other" ? "#cbd5e1" : PIE_COLORS[i % PIE_COLORS.length],
    }));
  }, [classes, authorizedShares, allocatedShares]);

  const totalForPct = Math.max(1, pieData.reduce((s, p) => s + p.value, 0));
  const percent = (n: number) => Math.round((n / totalForPct) * 100);

  // ---------- Legend (sorted; Unallocated last) ----------
  const legendItems = useMemo(() => {
    const items = [...pieData];
    items.sort((a, b) => {
      const aUnalloc = a.label.toLowerCase() === "unallocated";
      const bUnalloc = b.label.toLowerCase() === "unallocated";
      if (aUnalloc && !bUnalloc) return 1;
      if (bUnalloc && !aUnalloc) return -1;
      return b.value - a.value;
    });
    return items;
  }, [pieData]);

  // ---------- Form helpers ----------
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

  function buildCompanyPayload(financials: FinancialRow[] = form.financials) {
    return {
      total_authorized_shares:
        form.total_authorized_shares.trim() === "" ? 0 : Number(form.total_authorized_shares.replace(/,/g, "")),
      current_fmv: unformatNumberString(form.current_fmv),
      current_market_value: unformatNumberString(form.current_market_value),
      volatility: percentDigitsToDecimalString(form.volatility),
      risk_free_rate: percentDigitsToDecimalString(form.risk_free_rate),
      financials: financials
        .filter((r) => r.year !== "")
        .map((r) => ({
          year: Number(r.year),
          revenue: r.revenue === "" ? null : r.revenue,
          net_income: r.net_income === "" ? null : r.net_income,
        })),
    };
  }

  // ---------- Save company ----------
  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNote(null);
    try {
      const payload = buildCompanyPayload();
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
          ? updated.financials.map((r: any) => ({
              year: r.year ?? "",
              revenue: r.revenue ?? null,
              net_income: r.net_income ?? null,
            }))
          : f.financials,
      }));
    } catch (err: any) {
      setNote({ type: "err", text: extractErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  // ---------- Per-row actions ----------
  async function saveFinancialRow(index: number) {
    const row = form.financials[index];
    if (!row?.year) {
      setNote({ type: "err", text: "Please enter a year before saving this row." });
      return;
    }
    try {
      await axios.post(`${API}${COMPANY_FINANCIALS}`, {
        year: Number(row.year),
        revenue: row.revenue === "" ? null : row.revenue,
        net_income: row.net_income === "" ? null : row.net_income,
      });
      setNote({ type: "ok", text: `Saved financials for ${row.year}.` });
    } catch (err: any) {
      setNote({ type: "err", text: extractErrorMessage(err) });
    }
  }

  async function removeFinancialRow(index: number) {
    const row = form.financials[index];
    if (!row?.year) {
      removeRow(index);
      return;
    }
    const ok = confirm(`Delete company financials for ${row.year}?`);
    if (!ok) return;
    try {
      await axios.delete(`${API}${COMPANY_FINANCIALS}${row.year}/`);
      removeRow(index);
      setNote({ type: "ok", text: `Removed financials for ${row.year}.` });
    } catch (err: any) {
      setNote({ type: "err", text: extractErrorMessage(err) });
    }
  }

  // ---------- Series/Class CRUD ----------
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
      const newList = [res.data, ...classes];
      setClasses(newList);
      setNewClass({ name: "", total_class_shares: "", series_id: "" });
      setShowClassModal(false);
      setNote({ type: "ok", text: "Class added." });
      setOpenClasses(true);
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
      const newList = [res.data, ...series];
      setSeries(newList);
      setNewSeries({ name: "", share_type: null });
      setShowSeriesModal(false);
      setNote({ type: "ok", text: "Series added." });
      setOpenSeries(true);
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

  // ---------- Render ----------
  if (loading)
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-4 px-6">
        <div className="w-full">
          <div className="bg-white rounded-xl shadow-lg overflow-hidden p-6 text-center text-gray-700">
            Loading company data…
          </div>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-4 px-6">
      <div className="w-full">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden w-full ring-1 ring-black/5">
          <div className="px-8 py-6">
            {/* Page header */}
            <div className="mb-8 text-center">
              <h1 className="text-3xl font-bold text-gray-900">{form.name ?? "Company"}</h1>
              <p className="text-sm text-gray-600">Manage valuation inputs, share allocations, and historical financials</p>
            </div>

            {note && (
              <div
                role="alert"
                className={`rounded-lg border p-3 text-sm mb-6 ${
                  note.type === "ok"
                    ? "border-green-200 bg-green-50 text-green-700"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                {note.text}
              </div>
            )}

            {/* ===== Top row: Metrics + Share Allocation ===== */}
            <section className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-10 items-stretch">
              {/* Company Metrics (cleaned layout) */}
              <div>
                <div className="bg-gray-50 rounded-lg border border-gray-200 p-6 h-full">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-lg font-semibold text-gray-900">Company Metrics</h2>
                  </div>

                  <form onSubmit={onSave} className="space-y-5" aria-label="Company metrics form">
                    {/* Row 1 */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <label className="block">
                        <span className="block text-sm text-gray-700">Total Authorized Shares</span>
                        <input
                          aria-label="Total Authorized Shares"
                          className="mt-1 w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          value={formatSharesDisplay(form.total_authorized_shares)}
                          onChange={(e) => updateField("total_authorized_shares", e.target.value.replace(/\D/g, ""))}
                          onBlur={(e) => updateField("total_authorized_shares", e.target.value.replace(/\D/g, "") || "0")}
                          placeholder="0"
                          inputMode="numeric"
                        />
                        <span className="mt-1 block text-xs text-gray-600">
                          Remaining: <b className="tabular-nums">{remainingShares.toLocaleString()}</b>
                        </span>
                      </label>

                      <label className="block">
                        <span className="block text-sm text-gray-700">Current Market Value</span>
                        <div className="relative mt-1">
                          <input
                            aria-label="Current Market Value"
                            className="w-full border rounded-lg pl-10 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            value={formatWithCommas(sanitizeNumberInput(form.current_market_value))}
                            onChange={(e) => updateField("current_market_value", sanitizeNumberInput(e.target.value))}
                            onBlur={(e) => updateField("current_market_value", sanitizeNumberInput(e.target.value) || "0")}
                            placeholder="0"
                            inputMode="decimal"
                          />
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                            $
                          </span>
                        </div>
                      </label>
                    </div>

                    {/* Row 2 */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <label className="block">
                        <span className="block text-sm text-gray-700">FMV</span>
                        <div className="relative mt-1">
                          <input
                            aria-label="Fair Market Value"
                            className="w-full border rounded-lg pl-10 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            value={formatWithCommas(sanitizeNumberInput(form.current_fmv))}
                            onChange={(e) => updateField("current_fmv", sanitizeNumberInput(e.target.value))}
                            onBlur={(e) => updateField("current_fmv", sanitizeNumberInput(e.target.value) || "0")}
                            placeholder="0"
                            inputMode="decimal"
                          />
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                            $
                          </span>
                        </div>
                      </label>

                      <label className="block">
                        <span className="block text-sm text-gray-700">Volatility</span>
                        <div className="relative mt-1">
                          <input
                            aria-label="Volatility percent"
                            className="w-full border rounded-lg pr-10 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            value={form.volatility.replace(/\D/g, "") || "0"}
                            onChange={(e) => updateField("volatility", e.target.value.replace(/\D/g, ""))}
                            onBlur={(e) => updateField("volatility", e.target.value.replace(/\D/g, "") || "0")}
                            placeholder="0"
                            inputMode="numeric"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                            %
                          </span>
                        </div>
                      </label>

                      <label className="block">
                        <span className="block text-sm text-gray-700">Risk Free Rate</span>
                        <div className="relative mt-1">
                          <input
                            aria-label="Risk-free rate percent"
                            className="w-full border rounded-lg pr-10 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            value={form.risk_free_rate.replace(/\D/g, "") || "0"}
                            onChange={(e) => updateField("risk_free_rate", e.target.value.replace(/\D/g, ""))}
                            onBlur={(e) => updateField("risk_free_rate", e.target.value.replace(/\D/g, "") || "0")}
                            placeholder="0"
                            inputMode="numeric"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                            %
                          </span>
                        </div>
                      </label>
                    </div>

                    <div className="pt-2 flex gap-3 justify-end">
                      <button
                        type="submit"
                        disabled={saving}
                        className="bg-indigo-600 text-white font-semibold px-4 py-2 rounded-lg transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
                      >
                        {saving ? "Saving…" : "Save Changes"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>

              {/* Share Allocation (heading removed; spacing increased) */}
              <div className="bg-gray-50 rounded-lg border border-gray-200 p-6 flex flex-col">
                {/* KPIs for quick glance */}
                <div className="grid grid-cols-3 gap-3 mb-6 md:mb-8">
                  <div className="rounded-lg border bg-white p-3 text-center">
                    <div className="text-[11px] text-gray-500">Authorized</div>
                    <div className="text-sm font-semibold tabular-nums">
                      {authorizedShares.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-white p-3 text-center">
                    <div className="text-[11px] text-gray-500">Allocated</div>
                    <div className="text-sm font-semibold tabular-nums">
                      {allocatedShares.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-white p-3 text-center">
                    <div className="text-[11px] text-gray-500">Remaining</div>
                    <div className="text-sm font-semibold tabular-nums">
                      {remainingShares.toLocaleString()}
                    </div>
                  </div>
                </div>

                {authorizedShares <= 0 ? (
                  <p className="text-sm text-gray-600">
                    Set <b>Total Authorized Shares</b> to see allocation.
                  </p>
                ) : (
                  <div className="mt-1 grid grid-cols-1 md:grid-cols-[minmax(240px,280px)_minmax(0,1fr)] gap-7 items-start">
                    {/* Fixed chart column */}
                    <div className="flex justify-center md:justify-start">
                      <DonutChart
                        data={pieData}
                        size={220}
                        thickness={24}
                        gap={2}
                        centerLabel={
                          <div className="leading-tight">
                            <div className="text-[10px] text-gray-500">Remaining</div>
                            <div className="font-semibold text-sm">
                              {remainingShares.toLocaleString()}
                            </div>
                          </div>
                        }
                      />
                    </div>

                    {/* Legend column */}
                    <div className="min-w-0">
                      <ul
                        className="grid grid-cols-1 gap-y-2 max-h-[260px] overflow-auto pr-1"
                        aria-label="Share allocation legend"
                      >
                        {legendItems.map((s, i) => (
                          <li key={i} className="flex items-center justify-between gap-3 text-sm min-w-0">
                            <span className="flex items-center gap-2 min-w-0">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-black/10 shrink-0"
                                style={{ background: s.color }}
                                aria-hidden="true"
                              />
                              <span className="truncate" title={s.label}>
                                {s.label}
                              </span>
                            </span>
                            <span className="shrink-0 tabular-nums text-right">
                              {s.value.toLocaleString()}{" "}
                              <span className="ml-1 inline-block rounded border px-1.5 py-0.5 text-[10px] text-gray-700 align-middle">
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

            {/* ===== Series / Rounds ===== */}
            <section className="mt-4 mb-10">
              <div className="border rounded-lg bg-white">
                <button
                  type="button"
                  onClick={() => setOpenSeries((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3"
                  aria-expanded={openSeries}
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
                        className="rounded-lg px-3 py-1 border border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                              className="w-full sm:w-auto rounded-lg px-3 py-2 border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
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

            {/* ===== Classes ===== */}
            <section className="mt-4 mb-10">
              <div className="border rounded-lg bg-white">
                <button
                  type="button"
                  onClick={() => setOpenClasses((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3"
                  aria-expanded={openClasses}
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
                        className="rounded-lg px-3 py-1 border border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        onClick={() => setShowClassModal(true)}
                      >
                        + Add Class
                      </button>
                    </div>

                    <div className="space-y-3">
                      {classes.length === 0 && (
                        <div className="text-gray-500 text-sm">No classes configured. Click “Add Class”.</div>
                      )}

                      {classes.map((c) => {
                        const total = toShareNumber(c.total_class_shares);
                        const alloc = toShareNumber((c as any).shares_allocated);
                        const remaining = toShareNumber((c as any).shares_remaining);
                        const computedRemaining = Math.max(0, total - alloc);
                        const remFinal = remaining > 0 || computedRemaining === 0 ? remaining || 0 : computedRemaining;

                        return (
                          <div key={String(c.id)} className="grid grid-cols-12 gap-2 items-start border rounded-lg p-3">
                            <div className="col-span-12 sm:col-span-4">
                              <div className="text-xs text-gray-600 mb-1">Name</div>
                              <div className="font-medium">{c.name}</div>
                              {c.series?.name && (
                                <div className="mt-1 text-xs text-gray-600">
                                  Linked Series: {c.series.name} (
                                  {displaySeriesType(c.series?.share_type)})
                                </div>
                              )}
                            </div>

                            <div className="col-span-6 sm:col-span-2">
                              <div className="text-xs text-gray-600 mb-1">Type</div>
                              <div>{(c.share_type ?? c.series?.share_type) === "COMMON" ? "Common" : "Preferred"}</div>
                            </div>

                            <div className="col-span-6 sm:col-span-2">
                              <div className="text-xs text-gray-600 mb-1">Total Class Shares</div>
                              <div className="tabular-nums">{total.toLocaleString()}</div>
                            </div>

                            <div className="col-span-6 sm:col-span-2">
                              <div className="text-xs text-gray-600 mb-1">Allocated</div>
                              <div className="tabular-nums">{alloc.toLocaleString()}</div>
                            </div>

                            <div className="col-span-6 sm:col-span-2">
                              <div className="text-xs text-gray-600 mb-1">Remaining (Unallocated)</div>
                              <div className="tabular-nums">{Math.max(0, remFinal).toLocaleString()}</div>
                            </div>

                            <div className="col-span-12 sm:col-span-12 flex sm:justify-end">
                              <button
                                type="button"
                                className="w-full sm:w-auto rounded-lg px-3 py-2 border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                                onClick={() => {
                                  if (confirm(`Delete class "${c.name}"?`)) deleteClass(c.id);
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ===== Company Financials ===== */}
            <section className="mt-4 mb-10">
              <div className="border rounded-lg bg-white">
                <button
                  type="button"
                  onClick={() => setOpenFinancials((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3"
                  aria-expanded={openFinancials}
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
                      <button
                        type="button"
                        className="rounded-lg px-3 py-1 border border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        onClick={addRow}
                      >
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
                              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              value={row.year}
                              onChange={(e) =>
                                updateFinancial(i, "year", e.target.value === "" ? "" : Number(e.target.value))
                              }
                              min={1900}
                            />
                          </div>

                          <div className="col-span-12 sm:col-span-4">
                            <label className="block text-sm mb-1">Revenue (USD)</label>
                            <div className="relative">
                              <input
                                type="number"
                                step="0.01"
                                className="w-full border rounded-lg pl-10 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                value={row.revenue ?? ""}
                                onChange={(e) => updateFinancial(i, "revenue", e.target.value)}
                              />
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                                $
                              </span>
                            </div>
                          </div>

                          <div className="col-span-12 sm:col-span-4">
                            <label className="block text-sm mb-1">Net Income (USD)</label>
                            <div className="relative">
                              <input
                                type="number"
                                step="0.01"
                                className="w-full border rounded-lg pl-10 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                value={row.net_income ?? ""}
                                onChange={(e) => updateFinancial(i, "net_income", e.target.value)}
                              />
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                                $
                              </span>
                            </div>
                          </div>

                          <div className="col-span-12 sm:col-span-2 flex gap-2">
                            <button
                              type="button"
                              className="w-1/2 rounded-lg px-3 py-2 bg-indigo-600 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              onClick={() => saveFinancialRow(i)}
                              title="Save this year"
                            >
                              Save
                            </button>

                            <button
                              type="button"
                              className="w-1/2 rounded-lg px-3 py-2 border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                              onClick={() => removeFinancialRow(i)}
                              title="Remove this year"
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

            {/* ---------- Modals ---------- */}
            {showClassModal && (
              <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
                <div className="bg-white rounded-xl p-4 w-full max-w-md shadow-lg">
                  <h3 className="text-lg font-semibold mb-3">Add Class</h3>
                  <div className="space-y-3">
                    <label className="block">
                      <span className="block text-sm mb-1">Name</span>
                      <input
                        className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={newClass.name}
                        onChange={(e) => setNewClass((s) => ({ ...s, name: e.target.value }))}
                      />
                    </label>

                    <label className="block">
                      <span className="block text-sm mb-1">Total Class Shares</span>
                      <input
                        type="number"
                        min={0}
                        className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={newClass.total_class_shares}
                        onChange={(e) => setNewClass((s) => ({ ...s, total_class_shares: e.target.value }))}
                        placeholder="e.g. 1000000"
                      />
                    </label>

                    <label className="block">
                      <span className="block text-sm mb-1">Series (required)</span>
                      <select
                        className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                    <button className="px-3 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700" onClick={createClass}>
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
                        className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={newSeries.name}
                        onChange={(e) => setNewSeries((s) => ({ ...s, name: e.target.value }))}
                      />
                    </label>

                    <label className="block">
                      <span className="block text-sm mb-1">Share Type</span>
                      <select
                        className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                    <button className="px-3 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700" onClick={createSeries}>
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