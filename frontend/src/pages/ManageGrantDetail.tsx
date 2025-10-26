import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

const API = import.meta.env.VITE_API_URL as string;

/* ---------------- Types ---------------- */

type Detail = {
  id: number;
  stock_class_name: string | null;
  series_name: string | null;

  num_shares: number;
  iso_shares: number;
  nqo_shares: number;
  rsu_shares: number;
  common_shares: number;
  preferred_shares: number;

  strike_price: string | null;
  purchase_price: string | null;

  vesting_start: string | null;
  vesting_end: string | null;
  vesting_frequency: "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "YEARLY";

  vesting_status?: string;
};

type CompanyResp = {
  current_fmv?: string; // decimal string
  name?: string;
};

type SchedulePoint = {
  date: string; // YYYY-MM-DD
  iso?: number;
  nqo?: number;
  rsu?: number;
  common?: number;
  preferred?: number;
  total_vested?: number; // per-period vested shares in API
  cumulative_vested?: number; // optional; if present we use it
};

type Employee = {
  unique_id: string;
  name?: string;
  username?: string;
};

/* ---------------- Component ---------------- */

export default function ManageGrantDetail() {
  const { uniqueId = "", grantId = "" } = useParams();
  const nav = useNavigate();

  const [data, setData] = useState<Detail | null>(null);
  const [company, setCompany] = useState<CompanyResp | null>(null);
  const [schedule, setSchedule] = useState<SchedulePoint[] | null>(null);
  const [empName, setEmpName] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Detail>>({});

  useEffect(() => {
    const access = localStorage.getItem("accessToken");
    if (access) axios.defaults.headers.common["Authorization"] = `Bearer ${access}`;
  }, []);

  // Load grant detail + company settings + schedule + employee name
  useEffect(() => {
    async function run() {
      setLoading(true);
      setNote(null);
      try {
        const detailUrl = `${API}/equity/employees/${encodeURIComponent(uniqueId)}/grants/${grantId}/`;
        const scheduleUrl = `${API}/equity/employees/${encodeURIComponent(uniqueId)}/grants/${grantId}/schedule/`;
        const companyUrl = `${API}/company/`;

        const [grantRes, scheduleRes, companyRes] = await Promise.all([
          axios.get(detailUrl),
          axios.get(scheduleUrl).catch(() => ({ data: [] as SchedulePoint[] })), // tolerate missing schedule
          axios.get(companyUrl).catch(() => ({ data: {} as CompanyResp })),
        ]);

        setData(grantRes.data);
        setDraft(grantRes.data);
        setSchedule(Array.isArray(scheduleRes.data) ? scheduleRes.data : []);
        setCompany(companyRes.data ?? null);

        // Employee name for header (gracefully degrade to just ID)
        await fetchEmployeeName(uniqueId).then((nm) => setEmpName(nm));
      } catch (e: any) {
        setNote({ type: "err", text: apiErr(e) });
      } finally {
        setLoading(false);
      }
    }
    if (uniqueId && grantId) void run();
  }, [uniqueId, grantId]);

  async function onDelete() {
    if (!confirm("Delete this grant? This cannot be undone.")) return;
    setLoading(true);
    setNote(null);
    try {
      await axios.delete(
        `${API}/equity/employees/${encodeURIComponent(uniqueId)}/grants/${grantId}/`
      );
      setNote({ type: "ok", text: "Grant deleted." });
      nav(`/dashboard/grants/${encodeURIComponent(uniqueId)}`);
    } catch (e: any) {
      setNote({ type: "err", text: apiErr(e) });
    } finally {
      setLoading(false);
    }
  }

  async function onSave() {
    setLoading(true);
    setNote(null);
    try {
      const payload = {
        strike_price: draft.strike_price,
        purchase_price: draft.purchase_price,
        vesting_start: draft.vesting_start,
        vesting_end: draft.vesting_end,
        vesting_frequency: draft.vesting_frequency,
      };
      await axios.patch(
        `${API}/equity/employees/${encodeURIComponent(uniqueId)}/grants/${grantId}/`,
        payload
      );
      setNote({ type: "ok", text: "Saved." });
      setEditing(false);

      const res = await axios.get(
        `${API}/equity/employees/${encodeURIComponent(uniqueId)}/grants/${grantId}/`
      );
      setData(res.data);
      setDraft(res.data);
    } catch (e: any) {
      setNote({ type: "err", text: apiErr(e) });
    } finally {
      setLoading(false);
    }
  }

  // Derived
  const type = useMemo(() => getType(data), [data]);
  const needsStrike = type === "ISO" || type === "NQO";
  const needsPurchase = type === "COMMON" || type === "PREFERRED";
  const isRSU = type === "RSU";
  const isPreferred = type === "PREFERRED";

  const displayPrice =
    isRSU && company?.current_fmv
      ? `$${toMoney(company.current_fmv)} (FMV)`
      : needsStrike && data?.strike_price
      ? `$${toMoney(data.strike_price)}`
      : needsPurchase && data?.purchase_price
      ? `$${toMoney(data.purchase_price)}`
      : "—";

  // Normalize schedule for chart (we need cumulative over time)
  const chartData = useMemo(() => {
    if (!schedule?.length) return [];
    let cumulative = 0;
    return schedule.map((p) => {
      // If API already gives cumulative_vested, prefer it; otherwise accumulate total_vested
      if (typeof p.cumulative_vested === "number") {
        cumulative = p.cumulative_vested;
      } else {
        const step =
          typeof p.total_vested === "number"
            ? p.total_vested
            : Number(p.iso || 0) +
              Number(p.nqo || 0) +
              Number(p.rsu || 0) +
              Number(p.common || 0) +
              Number(p.preferred || 0);
        cumulative += step;
      }
      return { date: p.date, cumulative };
    });
  }, [schedule]);

  return (
    <div className="p-6 space-y-6">
      {/* Header: Employee ID + Name (no 'Grant #') */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">
            Employee: {uniqueId}
            {empName ? ` — ${empName}` : ""}
          </h1>
          {data?.stock_class_name && (
            <p className="text-xs text-gray-500 mt-1">
              Viewing grant details ({data.stock_class_name}
              {data.series_name ? ` / ${data.series_name}` : ""})
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => nav(`/dashboard/grants/${encodeURIComponent(uniqueId)}`)}
            className="border rounded px-3 py-1.5"
          >
            Back to List
          </button>
          <button onClick={onDelete} className="border rounded px-3 py-1.5 text-red-600">
            Delete
          </button>
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="rounded px-3 py-1.5 text-white bg-blue-600 hover:bg-blue-700"
            >
              Edit
            </button>
          ) : (
            <button
              onClick={onSave}
              className="rounded px-3 py-1.5 text-white bg-green-600 hover:bg-green-700"
            >
              Save
            </button>
          )}
        </div>
      </div>

      {note && (
        <div
          className={`rounded-md border p-3 text-sm mb-5 ${
            note.type === "ok"
              ? "border-green-300 text-green-700 bg-green-50"
              : "border-red-300 text-red-700 bg-red-50"
          }`}
        >
          {note.text}
        </div>
      )}

      {loading || !data ? (
        <div className="p-4 bg-white rounded-xl shadow">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* LEFT: details form */}
          <section className="xl:col-span-2 bg-white rounded-xl shadow p-4 space-y-4">
            <Section title="Overview" />
            <FieldRow label="Stock Class" value={data.stock_class_name ?? "—"} />
            <FieldRow label="Series" value={data.series_name ?? "—"} />
            <FieldRow label="Vesting Status" value={<StatusBadge value={data.vesting_status} />} />
            <FieldRow
              label="Totals"
              value={`${data.num_shares?.toLocaleString()} shares`}
            />

            <div className="border-t my-2" />

            <Section
              title="Pricing"
              subtitle={
                isRSU
                  ? "RSUs use the company's Fair Market Value (FMV)."
                  : needsStrike
                  ? "Options use a Strike Price."
                  : needsPurchase
                  ? "Stock uses a Purchase Price."
                  : undefined
              }
            />

            <div className="grid md:grid-cols-2 gap-3">
              <LabeledInput
                label="Strike Price (ISO/NQO)"
                type="number"
                step="0.01"
                placeholder={needsStrike ? "0.00" : "—"}
                disabled={!editing || !needsStrike}
                value={draft.strike_price ?? ""}
                onChange={(v) => setDraft((d) => ({ ...d, strike_price: v }))}
                prefix="$"
              />
              <LabeledInput
                label="Purchase Price (Stock)"
                type="number"
                step="0.01"
                placeholder={needsPurchase ? "0.00" : "—"}
                disabled={!editing || !needsPurchase}
                value={draft.purchase_price ?? ""}
                onChange={(v) => setDraft((d) => ({ ...d, purchase_price: v }))}
                prefix="$"
              />
            </div>

            <div className="border-t my-2" />

            <Section title="Vesting" />

            <div className="grid md:grid-cols-2 gap-3">
              <LabeledInput
                label="Vesting Start"
                type="date"
                disabled={!editing || isPreferred}
                value={draft.vesting_start ?? ""}
                onChange={(v) => setDraft((d) => ({ ...d, vesting_start: v }))}
              />
              <LabeledInput
                label="Vesting End"
                type="date"
                disabled={!editing || isPreferred}
                value={draft.vesting_end ?? ""}
                onChange={(v) => setDraft((d) => ({ ...d, vesting_end: v }))}
              />
              <div className="md:col-span-2">
                <label className="block text-sm mb-1">Vesting Frequency</label>
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  disabled={!editing || isPreferred}
                  value={draft.vesting_frequency ?? "MONTHLY"}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      vesting_frequency: e.target.value as Detail["vesting_frequency"],
                    }))
                  }
                >
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="BIWEEKLY">Bi-weekly</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="YEARLY">Yearly</option>
                </select>
              </div>
            </div>

            {/* Vesting schedule / chart */}
            <div className="border-t my-2" />
            <Section title="Vesting Schedule" />
            {isPreferred ? (
              <div className="rounded-lg border p-3 bg-gray-50 text-sm text-gray-700">
                Preferred shares vest immediately. No vesting schedule to display.
              </div>
            ) : chartData.length ? (
              <div className="rounded-lg border p-3 bg-white">
                <div className="text-xs text-gray-500 mb-2">
                  Cumulative vested shares over time
                </div>
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 12 }}
                        interval="preserveStartEnd"
                        tickFormatter={(d: string) => formatDateShort(d)}
                      />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        tickFormatter={(n) => formatShares(n)}
                        allowDecimals={false}
                      />
                      <Tooltip
                        formatter={(value: any) => [formatShares(value as number), "Cumulative Vested"]}
                        labelFormatter={(label) => `Date: ${formatDateLong(label as string)}`}
                      />
                      <Line type="monotone" dataKey="cumulative" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border p-3 bg-gray-50 text-sm text-gray-700">
                No schedule data available for this grant.
              </div>
            )}
          </section>

          {/* RIGHT: summary card */}
          <aside className="bg-white rounded-xl shadow p-4 space-y-3">
            <h3 className="text-sm font-semibold">Summary</h3>
            <div className="text-xs text-gray-600 space-y-1">
              <Row label="Type" value={<TypeBadge value={type} />} />
              <Row label="Status" value={<StatusBadge value={data.vesting_status} />} />
              <Row label="Total Shares" value={data.num_shares?.toLocaleString() ?? "—"} />
              <Row label={isRSU ? "RSU Price (FMV)" : "Price"} value={displayPrice} />
              {isRSU && (
                <Row
                  label="FMV Source"
                  value={company?.name ? `${company.name} / Company Settings` : "Company Settings"}
                />
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

/* ---------------- UI helpers ---------------- */

function Section({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-base font-semibold">{title}</h2>
      {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2 bg-gray-50">
      <span className="text-xs text-gray-600">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function LabeledInput({
  label,
  type = "text",
  step,
  disabled,
  value,
  onChange,
  placeholder,
  prefix,
}: {
  label: string;
  type?: string;
  step?: string;
  disabled?: boolean;
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  prefix?: string;
}) {
  return (
    <div>
      <label className="block text-sm mb-1">{label}</label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          type={type}
          step={step}
          className={`w-full border rounded-lg ${prefix ? "pl-8 pr-3" : "px-3"} py-2`}
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1 border-b last:border-b-0">
      <span className="text-xs text-gray-600">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function StatusBadge({ value }: { value?: string }) {
  let text = value ?? "—";
  const lower = (text || "").toLowerCase();
  if (lower.includes("immediate vest")) text = "Immediate Vesting";
  else if (lower.includes("fully vested")) text = "Fully Vested";
  else if (lower.includes("not vested")) text = "Not Vested";

  const color =
    text === "Immediate Vesting"
      ? "text-green-700 bg-green-50 border-green-200"
      : text === "Fully Vested"
      ? "text-blue-700 bg-blue-50 border-blue-200"
      : text === "Not Vested"
      ? "text-gray-700 bg-gray-50 border-gray-200"
      : "text-gray-800 bg-gray-50 border-gray-200";

  return (
    <span className={`text-[12px] px-2 py-0.5 rounded-full border ${color}`}>{text}</span>
  );
}

function TypeBadge({ value }: { value: string }) {
  const color =
    value === "PREFERRED"
      ? "text-purple-700 bg-purple-50 border-purple-200"
      : value === "COMMON"
      ? "text-blue-700 bg-blue-50 border-blue-200"
      : value === "ISO" || value === "NQO"
      ? "text-amber-700 bg-amber-50 border-amber-200"
      : value === "RSU"
      ? "text-teal-700 bg-teal-50 border-teal-200"
      : "text-gray-700 bg-gray-50 border-gray-200";
  return <span className={`text-[12px] px-2 py-0.5 rounded-full border ${color}`}>{value}</span>;
}

/* ---------------- Utilities ---------------- */

function getType(d: Detail | null): "COMMON" | "PREFERRED" | "ISO" | "NQO" | "RSU" | "—" {
  if (!d) return "—";
  if (d.preferred_shares > 0) return "PREFERRED";
  if (d.common_shares > 0) return "COMMON";
  if (d.rsu_shares > 0) return "RSU";
  if (d.iso_shares > 0) return "ISO";
  if (d.nqo_shares > 0) return "NQO";
  return "—";
}

function toMoney(v?: string | number | null): string {
  if (v == null || v === "") return "";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "";
  return n.toFixed(2);
}

function formatShares(n: number): string {
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString();
}
function formatDateShort(d: string): string {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
function formatDateLong(d: string): string {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

async function fetchEmployeeName(uid: string): Promise<string | null> {
  try {
    // Try detail endpoint first if it exists
    const res1 = await axios.get(`${API}/employees/${encodeURIComponent(uid)}/`).catch(() => null);
    if (res1?.data) {
      const n = res1.data.name || res1.data.username;
      return n || null;
    }
    // Fallback: list & find
    const res = await axios.get<Employee[]>(`${API}/employees/`);
    if (Array.isArray(res.data)) {
      const match = res.data.find((e) => e.unique_id === uid);
      const name = match?.name || match?.username;
      return name || null;
    }
  } catch {
    // ignore
  }
  return null;
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