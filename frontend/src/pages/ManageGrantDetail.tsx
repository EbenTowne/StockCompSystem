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

/* =========================
   Types
   ========================= */

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

  // helpers from API
  cliff_months?: number;
  shares_per_period?: number;
};

type CompanyResp = {
  current_fmv?: string;
  name?: string;
  total_authorized_shares?: number | string;
};

type SchedulePoint = {
  date: string; // 'YYYY-MM-DD'
  iso?: number;
  nqo?: number;
  rsu?: number;
  common?: number;
  preferred?: number;
  total_vested?: number;       // shares vested this period
  cumulative_vested?: number;  // optional; we compute if missing
};

type Employee = {
  unique_id: string;
  name?: string;
  username?: string;
};

/* =========================
   Page
   ========================= */

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
          axios.get(scheduleUrl).catch(() => ({ data: [] as SchedulePoint[] })),
          axios.get(companyUrl).catch(() => ({ data: {} as CompanyResp })),
        ]);

        setData(grantRes.data);
        setDraft(grantRes.data);

        const sched = Array.isArray((scheduleRes as any).data?.schedule)
          ? (scheduleRes as any).data.schedule
          : Array.isArray(scheduleRes.data)
          ? scheduleRes.data
          : [];
        setSchedule(sched);

        setCompany(companyRes.data ?? null);

        const nm = await fetchEmployeeName(uniqueId);
        setEmpName(nm);
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
      nav(`/dashboard/grants?id=${encodeURIComponent(uniqueId)}`);
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

  /* ---------- Derived ---------- */
  const type = useMemo(
    (): "ISO" | "NQO" | "RSU" | "COMMON" | "PREFERRED" | "—" => getType(data),
    [data]
  );
  const needsStrike = type === "ISO" || type === "NQO";
  const needsPurchase = type === "COMMON" || type === "PREFERRED";
  const isRSU = type === "RSU";
  const isPreferred = type === "PREFERRED";

  const displayPriceLabel = isRSU
    ? "RSU Price (FMV)"
    : needsStrike
    ? "Strike Price"
    : needsPurchase
    ? "Purchase Price"
    : "Price";

  const displayPrice =
    isRSU && company?.current_fmv
      ? `$${toMoney(company.current_fmv)}`
      : needsStrike && data?.strike_price
      ? `$${toMoney(data.strike_price)}`
      : needsPurchase && data?.purchase_price
      ? `$${toMoney(data.purchase_price)}`
      : "—";

  const ownershipPct = useMemo(() => {
    if (!company || company.total_authorized_shares == null || !data?.num_shares) return "—";
    const cap = Number(company.total_authorized_shares);
    if (!cap || cap <= 0) return "—";
    const pct = (Number(data.num_shares) / cap) * 100;
    return `${pct.toFixed(2)}%`;
  }, [company, data?.num_shares]);

  /* ---------- Build chart from API schedule with frequency-aware X axis ---------- */
  type ChartPoint = { key: string; date: string; cumulative: number };

  const chartData: ChartPoint[] = useMemo(() => {
    if (!schedule || schedule.length === 0) return [];
    const freq = (data?.vesting_frequency || "MONTHLY").toUpperCase();

    // Sort schedule by date, compute cumulative if not provided
    const sorted = [...schedule].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let running = 0;

    // For MONTHLY/YEARLY we group; for DAILY/WEEKLY/BIWEEKLY we keep each entry.
    const groupLast = new Map<string, ChartPoint>();

    const makeKey = (isoDate: string): string => {
      const d = new Date(isoDate + "T00:00:00Z");
      const y = d.getUTCFullYear();
      const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
      const day = d.getUTCDate().toString().padStart(2, "0");

      if (freq === "DAILY") return `${y}-${m}-${day}`;
      if (freq === "WEEKLY" || freq === "BIWEEKLY") {
        // Use actual event date as the period key
        return `${y}-${m}-${day}`;
      }
      if (freq === "YEARLY") return `${y}`;
      // default monthly
      return `${y}-${m}`;
    };

    for (const p of sorted) {
      const step =
        typeof p.total_vested === "number"
          ? p.total_vested
          : Number(p.iso || 0) +
            Number(p.nqo || 0) +
            Number(p.rsu || 0) +
            Number(p.common || 0) +
            Number(p.preferred || 0);

      const cum =
        typeof p.cumulative_vested === "number" ? p.cumulative_vested : (running += step);
      if (typeof p.cumulative_vested === "number") running = p.cumulative_vested;

      const key = makeKey(p.date);
      const point: ChartPoint = { key, date: p.date, cumulative: cum };

      if (freq === "MONTHLY" || freq === "YEARLY") {
        // overwrite so we keep "last in group"
        groupLast.set(key, point);
      } else {
        groupLast.set(`${key}-${p.date}`, point); // keep all occurrences for daily/weekly/biweekly
      }
    }

    let arr = Array.from(groupLast.values()).sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0
    );

    // YEARLY: Expand over full start..end years and carry values forward
    if (freq === "YEARLY") {
      const startYear =
        (data?.vesting_start && new Date(data.vesting_start + "T00:00:00Z").getUTCFullYear()) ||
        (arr[0] && new Date(arr[0].date + "T00:00:00Z").getUTCFullYear());
      const endYear =
        (data?.vesting_end && new Date(data.vesting_end + "T00:00:00Z").getUTCFullYear()) ||
        (arr[arr.length - 1] &&
          new Date(arr[arr.length - 1].date + "T00:00:00Z").getUTCFullYear());

      if (startYear && endYear) {
        const yearToCum = new Map<string, number>();
        for (const p of arr) {
          const y = new Date(p.date + "T00:00:00Z").getUTCFullYear().toString();
          yearToCum.set(y, p.cumulative);
        }

        const expanded: ChartPoint[] = [];
        let last = 0;
        for (let y = startYear; y <= endYear; y++) {
          const ys = y.toString();
          if (yearToCum.has(ys)) last = yearToCum.get(ys)!;
          expanded.push({
            key: ys,
            date: `${ys}-12-31`,
            cumulative: last,
          });
        }
        arr = expanded;
      }
    }

    return arr;
  }, [schedule, data?.vesting_frequency, data?.vesting_start, data?.vesting_end]);

  // Dynamic ticks so labels don’t crowd. Aim ~10 ticks.
  const xTicks = useMemo(() => {
    const n = chartData.length;
    if (n <= 12) return chartData.map((d) => d.key);
    const step = Math.ceil(n / 10);
    const out: string[] = [];
    for (let i = 0; i < n; i += step) out.push(chartData[i].key);
    if (out[out.length - 1] !== chartData[n - 1].key) out.push(chartData[n - 1].key);
    return out;
  }, [chartData]);

  const xFormatter = (key: string) => {
    // keys are YYYY, YYYY-MM or YYYY-MM-DD
    if (/^\d{4}$/.test(key)) return key;
    if (/^\d{4}-\d{2}$/.test(key)) {
      return new Date(`${key}-01T00:00:00Z`).toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      });
    }
    return new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  /* ---------- UI (now inside a white block like ManageGrants) ---------- */
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-4 px-6">
      <div className="w-full">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden w-full ring-1 ring-black/5">
          <div className="px-8 py-6">
            {/* Header — simplified */}
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {type !== "—" ? `${type} Stock Option` : "Stock Option"}
                </h1>
                <p className="mt-1 text-sm text-gray-700">
                  <span className="font-medium">Employee:</span> {empName ?? "Employee"}
                </p>
                <p className="text-sm text-gray-700">
                  <span className="font-medium">ID:</span> {uniqueId}
                </p>
              </div>

              <div className="flex shrink-0 gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    nav(`/dashboard/grants?id=${encodeURIComponent(uniqueId)}`)
                  }
                >
                  Back to List
                </Button>
                <Button variant="danger" onClick={onDelete}>
                  Delete
                </Button>
                {!editing ? (
                  <Button onClick={() => setEditing(true)}>Edit</Button>
                ) : (
                  <Button variant="success" onClick={onSave}>
                    Save
                  </Button>
                )}
              </div>
            </div>

            {/* Global Alert */}
            {note && (
              <Alert type={note.type === "ok" ? "success" : "error"} className="mb-6">
                {note.text}
              </Alert>
            )}

            {loading || !data ? (
              <Card className="p-6">
                <SkeletonLines />
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {/* Summary */}
                <Card>
                  <SectionHeader
                    title="Summary"
                    subtitle={
                      (data.stock_class_name || data.series_name) ? (
                        <Badge tone="indigo">
                          {data.stock_class_name}
                          {data.series_name ? ` · ${data.series_name}` : ""}
                        </Badge>
                      ) : null
                    }
                  />
                  <div className="mt-4 divide-y divide-gray-100 text-sm">
                    <SummaryRow label="Total Shares" value={data.num_shares?.toLocaleString() ?? "—"} />
                    <SummaryRow label="Share Type" value={<TypeBadge value={type} />} />
                    <SummaryRow label="Vesting Status" value={<StatusBadge value={data.vesting_status} />} />
                    <SummaryRow label={displayPriceLabel} value={displayPrice} />
                    <SummaryRow label="Ownership %" value={ownershipPct} />
                  </div>
                </Card>

                {/* Vesting */}
                <Card>
                  <SectionHeader title="Vesting" />
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <LabeledInput
                      id="vesting_start"
                      label="Vesting Start"
                      type="date"
                      disabled={!editing || isPreferred}
                      value={draft.vesting_start ?? ""}
                      onChange={(v) => setDraft((d) => ({ ...d, vesting_start: v }))}
                    />
                    <LabeledInput
                      id="vesting_end"
                      label="Vesting End"
                      type="date"
                      disabled={!editing || isPreferred}
                      value={draft.vesting_end ?? ""}
                      onChange={(v) => setDraft((d) => ({ ...d, vesting_end: v }))}
                    />
                    <div className="md:col-span-2 grid gap-4 md:grid-cols-3">
                      <FormControl label="Vesting Frequency" htmlFor="vesting_frequency">
                        <select
                          id="vesting_frequency"
                          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition-shadow focus:ring-4 focus:ring-indigo-100 disabled:opacity-60"
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
                      </FormControl>

                      <ReadOnlyBox label="Cliff Months" value={data.cliff_months ?? 0} />
                      <ReadOnlyBox label="Shares / Period" value={data.shares_per_period ?? 0} />
                    </div>
                  </div>
                </Card>

                {/* Vesting Schedule */}
                <Card>
                  <SectionHeader
                    title="Vesting Schedule"
                    subtitle={`Cumulative shares vested (${(data.vesting_frequency || "MONTHLY")
                      .toString()
                      .toLowerCase()})`}
                  />
                  <div className="mt-4">
                    {isPreferred ? (
                      <EmptyState message="Preferred shares vest immediately. No schedule to display." />
                    ) : chartData.length ? (
                      <div className="rounded-xl border border-gray-200 bg-white p-3">
                        <div className="mb-2 text-xs text-gray-500">
                          Cumulative vested shares ({(data.vesting_frequency || "MONTHLY")
                            .toString()
                            .toLowerCase()})
                        </div>
                        <div style={{ width: "100%", height: 260 }}>
                          <ResponsiveContainer>
                            <LineChart
                              data={chartData}
                              margin={{ top: 6, right: 8, left: 6, bottom: 6 }}
                            >
                              <CartesianGrid strokeDasharray="2 4" />
                              <XAxis
                                dataKey="key"
                                ticks={xTicks}
                                interval={0}
                                tick={{ fontSize: 11 }}
                                tickFormatter={xFormatter}
                                minTickGap={10}
                                axisLine={false}
                                tickLine={false}
                                allowDuplicatedCategory={false}
                              />
                              <YAxis
                                tick={{ fontSize: 12 }}
                                tickFormatter={(n) => formatShares(n)}
                                allowDecimals={false}
                                axisLine={false}
                                tickLine={false}
                                domain={[0, data?.num_shares || "auto"]}
                              />
                              <Tooltip
                                formatter={(value: any) => [
                                  formatShares(value as number),
                                  "Cumulative Vested",
                                ]}
                                labelFormatter={(label) => `Period: ${xFormatter(label as string)}`}
                              />
                              <Line type="monotone" dataKey="cumulative" dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    ) : (
                      <EmptyState message="No schedule data available for this grant." />
                    )}
                  </div>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================
   Reusable UI Pieces
   ========================= */

function Card({
  children,
  className = "",
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <section
      className={`rounded-2xl border border-gray-200 bg-white/90 shadow-sm backdrop-blur-sm ${className}`}
    >
      <div className="p-6">{children}</div>
    </section>
  );
}

function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  className = "",
  disabled,
}: React.PropsWithChildren<{
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  variant?: "primary" | "secondary" | "danger" | "success";
  className?: string;
  disabled?: boolean;
}>) {
  const variants = {
    primary:
      "bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-200",
    secondary:
      "border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 focus:ring-gray-200",
    danger:
      "border border-red-300 bg-white text-red-600 hover:bg-red-50 focus:ring-red-200",
    success:
      "bg-green-600 text-white hover:bg-green-700 focus:ring-green-200",
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium shadow-sm outline-none transition-colors focus:ring-4 disabled:opacity-60 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

function Badge({
  children,
  tone = "gray",
}: React.PropsWithChildren<{ tone?: "gray" | "indigo" | "green" | "sky" }>) {
  const tones = {
    gray: "border-gray-200 bg-gray-50 text-gray-700",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    sky: "border-sky-200 bg-sky-50 text-sky-700",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${tones[tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {children}
    </span>
  );
}

function Alert({
  children,
  type = "success",
  className = "",
}: React.PropsWithChildren<{ type?: "success" | "error"; className?: string }>) {
  const styles =
    type === "success"
      ? "border-green-200 bg-green-50 text-green-800"
      : "border-red-200 bg-red-50 text-red-700";
  return (
    <div
      role="alert"
      className={`rounded-xl border px-4 py-3 text-sm ${styles} ${className}`}
    >
      {children}
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {subtitle && <div className="text-xs">{subtitle}</div>}
    </div>
  );
}

function LabeledInput({
  id,
  label,
  type = "text",
  value,
  onChange,
  disabled,
  placeholder,
}: {
  id: string;
  label: string;
  type?: string;
  value: string | number;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <FormControl label={label} htmlFor={id}>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition-shadow focus:ring-4 focus:ring-indigo-100 disabled:opacity-60"
        onChange={(e) => onChange(e.target.value)}
      />
    </FormControl>
  );
}

function FormControl({
  label,
  htmlFor,
  children,
}: React.PropsWithChildren<{ label: string; htmlFor: string }>) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-sm font-medium text-gray-700"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function ReadOnlyBox({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-sm text-gray-900">{value ?? "—"}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <span className="text-gray-600">{label}</span>
      <span className="text-gray-900">{value}</span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-600">
      {message}
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
      ? "text-indigo-700 bg-indigo-50 border-indigo-200"
      : text === "Not Vested"
      ? "text-amber-700 bg-amber-50 border-amber-200"
      : "text-gray-700 bg-gray-50 border-gray-200";

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${color}`}>
      {text}
    </span>
  );
}

function TypeBadge({ value }: { value?: string }) {
  const color =
    value === "RSU"
      ? "bg-violet-50 text-violet-700 border-violet-200"
      : value === "PREFERRED"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : value === "COMMON"
      ? "bg-sky-50 text-sky-700 border-sky-200"
      : "bg-gray-50 text-gray-700 border-gray-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${color}`}
    >
      {value ?? "—"}
    </span>
  );
}

function SkeletonLines({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-4 w-full animate-pulse rounded bg-gray-200"
          style={{ width: `${90 - i * 4}%` }}
        />
      ))}
    </div>
  );
}

/* =========================
   Utilities
   ========================= */

function getType(d: Detail | null): "COMMON" | "PREFERRED" | "ISO" | "NQO" | "RSU" | "—" {
  if (!d) return "—";
  if ((d.iso_shares || 0) > 0) return "ISO";
  if ((d.nqo_shares || 0) > 0) return "NQO";
  if ((d.rsu_shares || 0) > 0) return "RSU";
  if ((d.common_shares || 0) > 0) return "COMMON";
  if ((d.preferred_shares || 0) > 0) return "PREFERRED";
  return "—";
}

function toMoney(v?: string | number | null): string {
  if (v == null || v === "") return "";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatShares(n: number): string {
  if (!Number.isFinite(n)) return "";
  return Math.round(n).toLocaleString();
}

async function fetchEmployeeName(uid: string): Promise<string | null> {
  try {
    const res1 = await axios.get(`${API}/employees/${encodeURIComponent(uid)}/`).catch(() => null);
    if (res1?.data) {
      const n = res1.data.name || res1.data.username;
      if (n) return n;
    }
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
  if (!d) return e?.message || "Request failed.";
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