import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

// ---- API bases (same style as the rest of your app) ----
const API = import.meta.env.VITE_API_URL as string; // e.g. http://127.0.0.1:8000/api
const CLASSES_BASE = "/equity/classes/";
const SERIES_BASE = "/equity/series/";
const GRANTS_BASE = "/equity/grants/";

// Employees endpoint (works with your DRF view at /api/employees/)
const EMPLOYEES_URL =
  (import.meta.env.VITE_EMPLOYEES_URL as string | undefined) || "/employees/";

// ---- Types ----
type EquitySeries = { id: number; name: string; share_type: "COMMON" | "PREFERRED" };

// NOTE: shares_remaining is returned by your StockClass serializer.
// series is left on the type in case you reference it elsewhere, but it is NOT shown in the dropdown label.
type EquityClass = {
  id: number;
  name: string; // slug used by backend
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
  vesting_start: string;
  vesting_end: string;
};

// ---- Helpers ----
const onlyDigits = (v: string) => v.replace(/\D/g, "");

// Clamp to at most 2 decimals while typing (used for summary text only)
const money = (v: string) => {
  const cleaned = v.replace(/[^\d.]/g, "");
  const [i = "", d = ""] = cleaned.split(".");
  const dec = d.slice(0, 2);
  return d.length ? `${i}.${dec}` : i;
};

const toInt = (s: string) => {
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
};

// Round to exactly 2 decimals on submit
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

// ---- Component ----
export default function CreateGrant() {
  const [series, setSeries] = useState<EquitySeries[]>([]);
  const [classes, setClasses] = useState<EquityClass[]>([]);
  const [employees, setEmployees] = useState<Employee[] | null>(null); // null = not loaded or failed
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ type: "ok" | "err"; text: string } | null>(null);

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
    vesting_start: "",
    vesting_end: "",
  });

  // auth + lookups
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
      setEmployees(emps); // may be null if call failed
    } catch (e) {
      setNote({ type: "err", text: errText(e) });
    } finally {
      setLoading(false);
    }
  }

  // buckets + active
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

  // filter classes to share type
  const filteredClasses = useMemo(() => {
    if (!activeBucket) return classes;
    const needType: "COMMON" | "PREFERRED" =
      activeBucket === "PREFERRED" ? "PREFERRED" : "COMMON";
    return classes.filter((c) => c.share_type === needType);
  }, [classes, activeBucket]);

  // keep total in sync
  useEffect(() => {
    const sum =
      buckets.ISO +
      buckets.NQO +
      buckets.RSU +
      buckets.COMMON +
      buckets.PREFERRED;
    setForm((f) => ({ ...f, num_shares: sum ? String(sum) : "" }));
  }, [form.iso_shares, form.nqo_shares, form.rsu_shares, form.common_shares, form.preferred_shares]);

  // pricing rules
  const needsStrike = activeBucket === "ISO" || activeBucket === "NQO";
  const needsPurchase = activeBucket === "COMMON" || activeBucket === "PREFERRED";
  const preferredImmediate = activeBucket === "PREFERRED";

  // clear conflicting price inputs
  useEffect(() => {
    if (!activeBucket) return;
    setForm((f) => ({
      ...f,
      strike_price: needsStrike ? f.strike_price : "",
      purchase_price: needsPurchase ? f.purchase_price : "",
    }));
  }, [activeBucket]);

  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setNote(null);

    try {
      const payload = {
        user: form.unique_id.trim(), // employee unique_id (slug)
        stock_class: form.stock_class.trim(), // class name (slug)
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
      };

      const res = await axios.post(`${API}${GRANTS_BASE}`, payload);
      setNote({
        type: "ok",
        text: `Grant created successfully (ID ${res.data?.id ?? ""}).`,
      });

      // Soft reset for quick batch entry
      setForm((f) => ({
        ...f,
        iso_shares: "",
        nqo_shares: "",
        rsu_shares: "",
        common_shares: "",
        preferred_shares: "",
        num_shares: "",
        strike_price: "",
        purchase_price: "",
        vesting_start: "",
        vesting_end: "",
      }));
    } catch (e: any) {
      setNote({ type: "err", text: errText(e) });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    // Wider container + balanced grid to reduce empty gutters
    <div className="p-6 space-y-6">
      {/* Header + caption */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">Create Grant</h1>
          <p className="text-xs text-gray-500 mt-1">Guide a new employee grant step-by-step.</p>
        </div>
        <button
          type="button"
          onClick={loadOptions}
          className="border rounded px-3 py-1.5"
          disabled={loading}
        >
          Reload
        </button>
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

      {/* Main grid: 2/1 layout */}
      <form onSubmit={onSubmit} className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left rail */}
        <div className="xl:col-span-2 space-y-5">
          {/* 1) Basics */}
          <section className="bg-white rounded-xl shadow p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">1) Basics</h2>
              <span className="text-xs text-gray-500">Identify the employee and class.</span>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1">Employee</label>
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={form.unique_id}
                  onChange={(e) => setField("unique_id", e.target.value)}
                >
                  <option value="">
                    {Array.isArray(employees) ? "Select…" : "No employees found"}
                  </option>
                  {Array.isArray(employees) &&
                    employees.map((emp) => {
                      const label =
                        emp.name || emp.user?.first_name || emp.user?.username || emp.unique_id;
                      return (
                        <option key={emp.unique_id} value={emp.unique_id}>
                          {label}: {emp.unique_id}
                        </option>
                      );
                    })}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">Stock Class</label>
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={form.stock_class}
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
              </div>
            </div>
          </section>

          {/* 2) Share Type */}
          <section className="bg-white rounded-xl shadow p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">2) Share Type</h2>
              <span className="text-xs text-gray-500">Pick one type and set the amount.</span>
            </div>
            <div className="grid md:grid-cols-3 gap-3">
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
                <label className="block text-sm mb-1">Total Shares</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 bg-gray-50"
                  value={form.num_shares}
                  disabled
                />
              </div>
            </div>
          </section>

          {/* 3) Pricing */}
          <section className="bg-white rounded-xl shadow p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">3) Pricing</h2>
              <span className="text-xs text-gray-500">
                Options use a <b>Strike Price</b>. Stock uses a <b>Purchase Price</b>.
              </span>
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm mb-1">Strike Price (ISO/NQO)</label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-full border rounded-lg pl-9 pr-3 py-2"
                    placeholder={needsStrike ? "0.00" : "—"}
                    disabled={!needsStrike}
                    value={form.strike_price}
                    onChange={(e) => setField("strike_price", e.target.value)}
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                    $
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-sm mb-1">Purchase Price (Stock)</label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-full border rounded-lg pl-9 pr-3 py-2"
                    placeholder={needsPurchase ? "0.00" : "—"}
                    disabled={!needsPurchase}
                    value={form.purchase_price}
                    onChange={(e) => setField("purchase_price", e.target.value)}
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                    $
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* 4) Vesting */}
          <section className="bg-white rounded-xl shadow p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">4) Vesting</h2>
              <span className="text-xs text-gray-500">
                Preferred vests immediately. Others unlock over time.
              </span>
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm mb-1">Frequency</label>
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={form.vesting_frequency}
                  onChange={(e) =>
                    setField(
                      "vesting_frequency",
                      e.target.value as FormState["vesting_frequency"]
                    )
                  }
                  disabled={preferredImmediate}
                >
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="BIWEEKLY">Bi-weekly</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="YEARLY">Yearly</option>
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">Vesting Start</label>
                <input
                  type="date"
                  className="w-full border rounded-lg px-3 py-2"
                  value={form.vesting_start}
                  onChange={(e) => setField("vesting_start", e.target.value)}
                  disabled={preferredImmediate}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Vesting End</label>
                <input
                  type="date"
                  className="w-full border rounded-lg px-3 py-2"
                  value={form.vesting_end}
                  onChange={(e) => setField("vesting_end", e.target.value)}
                  disabled={preferredImmediate}
                />
              </div>
            </div>
          </section>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={!canSubmit || saving}
              className={`px-4 py-2 rounded-lg text-white ${canSubmit && !saving ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-400 cursor-not-allowed"}`}
            >
              {saving ? "Saving…" : "Create Grant"}
            </button>
            <button
              type="button"
              onClick={() =>
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
                  vesting_start: "",
                  vesting_end: "",
                })
              }
              className="px-4 py-2 rounded-lg border"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Right rail (simple summary) */}
        <aside className="space-y-5">
          <section className="bg-white rounded-xl shadow p-4 space-y-2">
            <h3 className="text-sm font-semibold">Summary</h3>
            <div className="text-xs text-gray-600 space-y-1">
              <div><b>Employee:</b> {form.unique_id || "—"}</div>
              <div><b>Class:</b> {form.stock_class || "—"}</div>
              <div><b>Type:</b> {activeBucket || "—"}</div>
              <div><b>Total Shares:</b> {form.num_shares || "0"}</div>
              {needsStrike && (
                <div><b>Strike Price:</b> {form.strike_price ? `$${money(form.strike_price)}` : "—"}</div>
              )}
              {needsPurchase && (
                <div><b>Purchase Price:</b> {form.purchase_price ? `$${money(form.purchase_price)}` : "—"}</div>
              )}
              {!preferredImmediate && (
                <>
                  <div><b>Vesting Start:</b> {form.vesting_start || "—"}</div>
                  <div><b>Vesting End:</b> {form.vesting_end || "—"}</div>
                  <div><b>Frequency:</b> {form.vesting_frequency}</div>
                </>
              )}
            </div>
          </section>
        </aside>
      </form>
    </div>
  );
}

/** Presentational input card used above */
function CardField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  active?: boolean | null;
}) {
  const { label, value, onChange, active } = props;
  return (
    <div className={`rounded-lg border p-3 ${active ? "border-blue-400 bg-blue-50/40" : ""}`}>
      <label className="block text-sm mb-1">{label}</label>
      <input
        className="w-full border rounded-lg px-3 py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        placeholder="0"
      />
    </div>
  );
}