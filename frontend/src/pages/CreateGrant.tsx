import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL as string; // e.g. http://127.0.0.1:8000/api
const CLASSES_BASE = "/equity/classes/";
const SERIES_BASE = "/equity/series/";
const GRANTS_BASE = "/equity/grants/";
const EMPLOYEES_URL =
  (import.meta.env.VITE_EMPLOYEES_URL as string | undefined) || "/employees/";

// ---------- Types ----------
type EquitySeries = { id: number; name: string; share_type: "COMMON" | "PREFERRED" };

type EquityClass = {
  id: number;
  name: string;
  share_type: "COMMON" | "PREFERRED";
  series?: EquitySeries | null;
  shares_remaining?: number;
};

type Employee = {
  unique_id: string;
  name?: string;
  user?: { first_name?: string; username?: string };
};

type FormState = {
  unique_id: string;
  stock_class: string;

  iso_shares: string;
  nqo_shares: string;
  rsu_shares: string;
  common_shares: string;
  preferred_shares: string;
  num_shares: string;

  strike_price: string;
  purchase_price: string;

  vesting_frequency: "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "YEARLY";
  vesting_start: string; // editable
  vesting_end: string;   // optional
  grant_date: string;    // Issue Date — today
  cliff_months: string;
};

// ---------- Helpers ----------
const onlyDigits = (v: string) => v.replace(/\D/g, "");

const toInt = (s: string) => {
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
};

const toMoney = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
};

const errText = (e: any) => {
  const d = e?.response?.data;
  if (!d) return "Unexpected error. Please try again.";
  if (typeof d === "string") return d;
  if (d.detail) return d.detail;
  return Object.entries(d)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join(" ");
};

// Dates
const todayStr = () => new Date().toISOString().slice(0, 10);
const toDate = (s: string) => {
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};
const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

function monthsBetweenFull(issueISO: string, startISO: string): number {
  const a = toDate(issueISO);
  const b = toDate(startISO);
  if (!a || !b) return 0;
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1; // full months only
  return Math.max(0, months);
}

function addMonths(issueISO: string, cliffMonths: number): string {
  const a = toDate(issueISO);
  if (!a) return todayStr();
  const d = new Date(a);
  const origDay = d.getDate();
  d.setMonth(d.getMonth() + cliffMonths);
  if (d.getDate() < origDay) d.setDate(0); // snap to month end if overflow
  return fmt(d);
}

// ---------- Small UI pieces ----------
function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
      <div className="pb-2 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900 tracking-tight">{title}</h2>
        {subtitle && <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function CardField({
  label,
  value,
  onChange,
  active,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  active?: boolean;
}) {
  return (
    <div className={`rounded-lg border bg-white p-3 ${active ? "ring-2 ring-indigo-500 border-indigo-300" : "border-gray-200"}`}>
      <label className="block text-sm mb-1 text-gray-700">{label}</label>
      <input
        inputMode="numeric"
        className="w-full h-10 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
      />
    </div>
  );
}

function SharesRemainingCallout({
  stockClass,
  classes,
}: {
  stockClass: string;
  classes: EquityClass[];
}) {
  const cls = classes.find((c) => c.name === stockClass);
  if (!cls || typeof cls.shares_remaining !== "number") return null;

  const rem = cls.shares_remaining;
  const tone =
    rem > 0 ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700";
  return (
    <div className={`mt-4 rounded-lg border ${tone} p-3 text-sm`}>
      {rem > 0 ? (
        <>
          <b>{rem.toLocaleString()}</b> share{rem === 1 ? "" : "s"} remaining in <b>{cls.name}</b>.
        </>
      ) : (
        <>
          No shares remaining in <b>{cls.name}</b>. Consider another class or reduce the grant size.
        </>
      )}
    </div>
  );
}

// ---------- Component ----------
export default function CreateGrant() {
  const [series, setSeries] = useState<EquitySeries[]>([]);
  const [classes, setClasses] = useState<EquityClass[]>([]);
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Large success toast
  const [success, setSuccess] = useState<{ id?: number; text: string } | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);

  const defaultToday = todayStr();
  const [form, setForm] = useState<FormState>({
    unique_id: "",
    stock_class: "",
    iso_shares: "",
    nqo_shares: "",
    rsu_shares: "",
    common_shares: "",
    preferred_shares: "",
    num_shares: "",
    strike_price: "",
    purchase_price: "",
    vesting_frequency: "MONTHLY",
    vesting_start: defaultToday,
    vesting_end: "",
    grant_date: defaultToday,
    cliff_months: "0",
  });

  // ---- bootstrap lookups/auth
  useEffect(() => {
    const access = localStorage.getItem("accessToken");
    if (access) axios.defaults.headers.common["Authorization"] = `Bearer ${access}`;
    void loadOptions();
  }, []);

  async function tryFetchEmployees(): Promise<Employee[] | null> {
    try {
      const url = EMPLOYEES_URL.startsWith("http") ? EMPLOYEES_URL : `${API}${EMPLOYEES_URL}`;
      const er = await axios.get(url);
      const arr = Array.isArray(er.data) ? er.data : [];
      const normalized = arr
        .map((e: any): Employee | null => {
          const unique_id = e?.unique_id ?? e?.user?.unique_id ?? e?.slug ?? null;
          if (!unique_id) return null;
          const name =
            e?.name ??
            e?.user?.first_name ??
            e?.first_name ??
            e?.display_name ??
            e?.user?.username ??
            "";
          return { unique_id, name, user: e?.user };
        })
        .filter(Boolean) as Employee[];
      return normalized.length ? normalized : null;
    } catch {
      return null;
    }
  }

  async function loadOptions() {
    setLoading(true);
    setNote(null);
    try {
      const [sr, cr, emps] = await Promise.all([
        axios.get(`${API}${SERIES_BASE}`),
        axios.get(`${API}${CLASSES_BASE}`),
        tryFetchEmployees(),
      ]);
      setSeries(Array.isArray(sr.data) ? sr.data : []);
      setClasses(Array.isArray(cr.data) ? cr.data : []);
      setEmployees(emps);
    } catch (e) {
      setNote({ type: "err", text: errText(e) });
    } finally {
      setLoading(false);
    }
  }

  // ---- share buckets
  const buckets = {
    ISO: toInt(form.iso_shares),
    NQO: toInt(form.nqo_shares),
    RSU: toInt(form.rsu_shares),
    COMMON: toInt(form.common_shares),
    PREFERRED: toInt(form.preferred_shares),
  };

  const activeBucket = useMemo(() => {
    const actives = Object.entries(buckets).filter(([, v]) => v > 0);
    return actives.length === 1 ? (actives[0][0] as keyof typeof buckets) : null;
  }, [form.iso_shares, form.nqo_shares, form.rsu_shares, form.common_shares, form.preferred_shares]);

  const filteredClasses = useMemo(() => {
    if (!activeBucket) return classes;
    const needType: "COMMON" | "PREFERRED" =
      activeBucket === "PREFERRED" ? "PREFERRED" : "COMMON";
    return classes.filter((c) => c.share_type === needType);
  }, [classes, activeBucket]);

  // keep total in sync
  useEffect(() => {
    const sum =
      buckets.ISO + buckets.NQO + buckets.RSU + buckets.COMMON + buckets.PREFERRED;
    setForm((f) => ({ ...f, num_shares: sum ? String(sum) : "" }));
  }, [form.iso_shares, form.nqo_shares, form.rsu_shares, form.common_shares, form.preferred_shares]);

  // price field enable/disable
  const needsStrike = activeBucket === "ISO" || activeBucket === "NQO";
  const needsPurchase = activeBucket === "COMMON" || activeBucket === "PREFERRED";
  const preferredImmediate = activeBucket === "PREFERRED";

  useEffect(() => {
    if (!activeBucket) return;
    setForm((f) => ({
      ...f,
      strike_price: needsStrike ? f.strike_price : "",
      purchase_price: needsPurchase ? f.purchase_price : "",
    }));
  }, [activeBucket]);

  // form utils
  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Start Date ↔ Cliff Months (anchored to Issue Date)
  useEffect(() => {
    const months = monthsBetweenFull(form.grant_date, form.vesting_start);
    setForm((f) => (f.cliff_months !== String(months) ? { ...f, cliff_months: String(months) } : f));
  }, [form.vesting_start, form.grant_date]);

  useEffect(() => {
    const m = toInt(form.cliff_months);
    const newStart = addMonths(form.grant_date, m);
    if (newStart !== form.vesting_start) {
      setForm((f) => ({ ...f, vesting_start: newStart }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.cliff_months]);

  const totalShares = toInt(form.num_shares);
  const nonZeroBucketCount =
    (buckets.ISO > 0 ? 1 : 0) +
    (buckets.NQO > 0 ? 1 : 0) +
    (buckets.RSU > 0 ? 1 : 0) +
    (buckets.COMMON > 0 ? 1 : 0) +
    (buckets.PREFERRED > 0 ? 1 : 0);

  const canSubmit =
    !!form.unique_id.trim() &&
    !!form.stock_class.trim() &&
    nonZeroBucketCount === 1 &&
    totalShares > 0 &&
    (needsStrike ? toMoney(form.strike_price) > 0 : true) &&
    (needsPurchase ? toMoney(form.purchase_price) > 0 : true) &&
    (preferredImmediate ||
      !form.vesting_end ||
      !form.vesting_start ||
      form.vesting_end >= form.vesting_start);

  // submit
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setNote(null);

    try {
      const payload = {
        user: form.unique_id.trim(),
        stock_class: form.stock_class.trim(),
        num_shares: totalShares,
        iso_shares: buckets.ISO,
        nqo_shares: buckets.NQO,
        rsu_shares: buckets.RSU,
        common_shares: buckets.COMMON,
        preferred_shares: buckets.PREFERRED,
        strike_price: needsStrike ? toMoney(form.strike_price) : null,
        purchase_price: needsPurchase ? toMoney(form.purchase_price) : null,
        vesting_frequency: form.vesting_frequency,
        vesting_start: preferredImmediate ? null : form.vesting_start || null,
        vesting_end: preferredImmediate ? null : form.vesting_end || null,
        grant_date: form.grant_date, // Issue Date
      };

      const res = await axios.post(`${API}${GRANTS_BASE}`, payload);
      const createdId = res.data?.id;

      // success UX
      setSuccess({ id: createdId, text: `Grant successfully issued (ID ${createdId})` });
      requestAnimationFrame(() =>
        topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );

      await loadOptions();

      const t = todayStr();
      setForm((f) => ({
        ...f,
        stock_class: "",
        iso_shares: "",
        nqo_shares: "",
        rsu_shares: "",
        common_shares: "",
        preferred_shares: "",
        num_shares: "",
        strike_price: "",
        purchase_price: "",
        vesting_start: t,
        vesting_end: "",
        grant_date: t,
        cliff_months: "0",
      }));

      window.setTimeout(() => setSuccess(null), 5000);
    } catch (e: any) {
      setNote({ type: "err", text: errText(e) });
    } finally {
      setSaving(false);
    }
  }

  // loading shell
  if (loading)
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-6">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden p-6 text-center text-gray-700 max-w-screen-2xl mx-auto">
          Loading…
        </div>
      </div>
    );

  // ---------- Render ----------
  return (
    <div ref={topRef} className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-6">
      {/* floating success toast */}
      {success && (
        <div className="fixed left-1/2 -translate-x-1/2 top-5 z-50 w:[min(90vw,48rem)]">
          <div
            role="status"
            className="relative rounded-2xl border border-green-300 bg-green-50 text-green-900 shadow-2xl ring-1 ring-green-500/20 px-5 py-4 md:py-5 flex items-start gap-3"
          >
            <svg aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="12" className="fill-green-500/20" />
              <path d="M7 12l3 3 7-7" className="stroke-green-700" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="text-sm md:text-base font-medium pr-8">{success.text}</div>
            <button
              onClick={() => setSuccess(null)}
              className="absolute right-3 top-3 rounded-md px-2 py-1 text-xs font-semibold text-green-800 hover:bg-green-100"
              aria-label="Dismiss success message"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* page container */}
      <div className="w-full">
        <div className="max-w-screen-2xl mx-auto">
          <div className="bg-white rounded-xl shadow-lg overflow-hidden w-full ring-1 ring-black/5">
            <div className="px-8 py-6">
              {/* header */}
              <div className="mb-6 text-center">
                <h1 className="text-3xl font-bold text-gray-900">Issue New Employee Option</h1>
                <p className="text-sm text-gray-500">
                  Create a new stock option following company standards
                </p>
              </div>

              {/* inline error */}
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

              {/* Main grid */}
              <form
                onSubmit={onSubmit}
                className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6 xl:items-start"
              >
                {/* SUMMARY (right rail) */}
                <aside
                  className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm
                             order-1 xl:order-none xl:col-start-2 xl:row-start-1
                             xl:self-start xl:sticky xl:top-6"
                  aria-label="Summary"
                >
                  <h3 className="text-lg font-medium text-gray-900 mb-3">Summary</h3>

                  <div className="divide-y divide-gray-100 text-sm text-gray-700">
                    {[
                      ["Employee", form.unique_id || "—"],
                      ["Class", form.stock_class || "—"],
                      ["Type", activeBucket || "—"],
                      ["Total Shares", form.num_shares || "0"],
                      ["Issue Date", form.grant_date],
                      ["Start Date", form.vesting_start || "—"],
                      ["End Date", form.vesting_end || "—"],
                      ["Cliff Months", form.cliff_months],
                    ].map(([k, v]) => (
                      <div key={k as string} className="flex items-center justify-between py-1.5">
                        <div className="text-gray-500">{k}</div>
                        <div className="tabular-nums text-right">{v as string}</div>
                      </div>
                    ))}
                  </div>

                  {form.stock_class && (
                    <SharesRemainingCallout stockClass={form.stock_class} classes={classes} />
                  )}
                </aside>

                {/* LEFT rail (form sections) */}
                <div className="space-y-6 order-2 xl:order-none">
                  {/* 1) Basics */}
                  <Section title="1) Basics">
                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm mb-1 text-gray-700">Employee</label>
                        <select
                          className="w-full h-10 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          value={form.unique_id}
                          aria-label="Employee"
                          onChange={(e) => setField("unique_id", e.target.value)}
                        >
                          <option value="">
                            {Array.isArray(employees) ? "Select…" : "No employees found"}
                          </option>
                          {Array.isArray(employees) &&
                            employees.map((emp) => {
                              const label =
                                emp.name ||
                                emp.user?.first_name ||
                                emp.user?.username ||
                                emp.unique_id;
                              return (
                                <option key={emp.unique_id} value={emp.unique_id}>
                                  {label}: {emp.unique_id}
                                </option>
                              );
                            })}
                        </select>
                        <p className="mt-1 text-xs text-gray-500/80">
                          Uses the employee’s unique ID for assignment.
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm mb-1 text-gray-700">Stock Class</label>
                        <select
                          className="w-full h-10 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          value={form.stock_class}
                          aria-label="Stock Class"
                          onChange={(e) => setField("stock_class", e.target.value)}
                        >
                          <option value="">Select…</option>
                          {filteredClasses.map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.name}
                              {typeof c.shares_remaining === "number"
                                ? ` — ${c.shares_remaining.toLocaleString()} remaining`
                                : ""}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500/80">
                          Classes filtered to match the selected share type when applicable.
                        </p>
                      </div>
                    </div>
                  </Section>

                  {/* 2) Share Type */}
                  <Section title="2) Share Type" subtitle="Pick one type and set the amount.">
                    <div className="grid md:grid-cols-3 xl:grid-cols-4 gap-3">
                      <CardField
                        label="ISO Options"
                        value={form.iso_shares}
                        onChange={(v) => setField("iso_shares", onlyDigits(v))}
                        active={activeBucket === "ISO"}
                      />
                      <CardField
                        label="NQO Options"
                        value={form.nqo_shares}
                        onChange={(v) => setField("nqo_shares", onlyDigits(v))}
                        active={activeBucket === "NQO"}
                      />
                      <CardField
                        label="RSUs"
                        value={form.rsu_shares}
                        onChange={(v) => setField("rsu_shares", onlyDigits(v))}
                        active={activeBucket === "RSU"}
                      />
                      <CardField
                        label="Common Stock"
                        value={form.common_shares}
                        onChange={(v) => setField("common_shares", onlyDigits(v))}
                        active={activeBucket === "COMMON"}
                      />
                      <CardField
                        label="Preferred Stock"
                        value={form.preferred_shares}
                        onChange={(v) => setField("preferred_shares", onlyDigits(v))}
                        active={activeBucket === "PREFERRED"}
                      />
                      <div>
                        <label className="block text-sm mb-1 text-gray-700">Total Shares</label>
                        <input
                          className="w-full h-10 border rounded-lg px-3 py-2 bg-gray-50"
                          value={form.num_shares}
                          disabled
                          aria-disabled
                        />
                      </div>
                    </div>
                  </Section>

                  {/* 3) Pricing */}
                  <Section
                    title="3) Pricing"
                    subtitle={
                      <>
                        Options use a <b>Strike Price</b>. Stock uses a <b>Purchase Price</b>.
                      </>
                    }
                  >
                    <div className="grid md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm mb-1 text-gray-700">
                          Strike Price (ISO/NQO)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="w-full h-10 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                          placeholder={needsStrike ? "0.00" : "—"}
                          disabled={!needsStrike}
                          aria-disabled={!needsStrike}
                          value={form.strike_price}
                          onChange={(e) => setField("strike_price", e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-sm mb-1 text-gray-700">
                          Purchase Price (Stock)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="w-full h-10 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                          placeholder={needsPurchase ? "0.00" : "—"}
                          disabled={!needsPurchase}
                          aria-disabled={needsPurchase ? undefined : true}
                          value={form.purchase_price}
                          onChange={(e) => setField("purchase_price", e.target.value)}
                        />
                      </div>
                    </div>
                  </Section>

                  {/* 4) Vesting (Frequency/Cliff first, then Dates) */}
                  <Section
                    title="4) Vesting"
                    subtitle="Preferred vests immediately. Others unlock over time."
                  >
                    <div className="space-y-4">
                      {/* Row 1: Frequency + Cliff */}
                      <div className="grid md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm mb-1 text-gray-700">Frequency</label>
                          <select
                            className="w-full h-10 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                            value={form.vesting_frequency}
                            onChange={(e) =>
                              setField(
                                "vesting_frequency",
                                e.target.value as FormState["vesting_frequency"]
                              )
                            }
                            disabled={preferredImmediate}
                            aria-disabled={preferredImmediate}
                          >
                            <option value="DAILY">Daily</option>
                            <option value="WEEKLY">Weekly</option>
                            <option value="BIWEEKLY">Bi-weekly</option>
                            <option value="MONTHLY">Monthly</option>
                            <option value="YEARLY">Yearly</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-sm mb-1 text-gray-700">Cliff (months)</label>
                          <input
                            inputMode="numeric"
                            className="w-full h-10 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                            value={form.cliff_months}
                            onChange={(e) => setField("cliff_months", onlyDigits(e.target.value))}
                            disabled={preferredImmediate}
                            aria-disabled={preferredImmediate}
                            placeholder="0"
                          />
                          <p className="mt-1 text-xs text-gray-500/80">
                            Time between Issue Date and Start Date. Changes in Cliff Month or Start Date impact the other field.
                          </p>
                        </div>
                      </div>

                      {/* Row 2: Dates */}
                      <div className="grid md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-sm mb-1 text-gray-700">Issue Date</label>
                          <input
                            type="date"
                            className="w-full h-10 border rounded-lg px-3 py-2 bg-gray-100"
                            value={form.grant_date}
                            disabled
                            aria-disabled
                          />
                        </div>
                        <div>
                          <label className="block text-sm mb-1 text-gray-700">Start Date</label>
                          <input
                            type="date"
                            className="w-full h-10 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                            value={form.vesting_start}
                            onChange={(e) => setField("vesting_start", e.target.value)}
                            disabled={preferredImmediate}
                            aria-disabled={preferredImmediate}
                          />
                        </div>
                        <div>
                          <label className="block text-sm mb-1 text-gray-700">End Date</label>
                          <input
                            type="date"
                            className="w-full h-10 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                            value={form.vesting_end}
                            onChange={(e) => setField("vesting_end", e.target.value)}
                            disabled={preferredImmediate}
                            aria-disabled={preferredImmediate}
                          />
                        </div>
                      </div>
                    </div>
                  </Section>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      className="rounded-lg px-4 py-2 border border-gray-200 hover:bg-gray-50"
                      onClick={() => {
                        const t = todayStr();
                        setForm({
                          unique_id: "",
                          stock_class: "",
                          iso_shares: "",
                          nqo_shares: "",
                          rsu_shares: "",
                          common_shares: "",
                          preferred_shares: "",
                          num_shares: "",
                          strike_price: "",
                          purchase_price: "",
                          vesting_frequency: "MONTHLY",
                          vesting_start: t,
                          vesting_end: "",
                          grant_date: t,
                          cliff_months: "0",
                        });
                      }}
                    >
                      Reset
                    </button>
                    <button
                      type="submit"
                      disabled={!canSubmit || saving}
                      className="bg-indigo-600 text-white font-semibold px-5 py-2.5 rounded-lg transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
                    >
                      {saving ? "Issuing…" : "Issue Grant"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}