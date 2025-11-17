import React, { useEffect, useState } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL as string;

type MonthEntry = { month: string; expense: number };

type DetailRow = {
  name: string;
  month: string;
  expense: number;
};

type CompanyExpenses = {
  company_id: number;
  start_month: string;
  end_month: string;
  total_expense_fair_value: number;
  months: MonthEntry[];
  grand_total_within_window: number;
  detail?: DetailRow[];
};

export default function Expenses() {
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CompanyExpenses | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setNote(null);

    try {
      const res = await axios.get<CompanyExpenses>(`${API}/equity/expenses/`);
      setData(res.data);

      if (!res.data.months || res.data.months.length === 0) {
        setNote(
          "No stock-based compensation expenses fall within the current window."
        );
      }
    } catch (e: any) {
      const msg = apiErr(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const access = localStorage.getItem("accessToken");
    if (access) {
      axios.defaults.headers.common["Authorization"] = `Bearer ${access}`;
    }
    void load();
  }, []);

  async function exportExpensesExcel() {
    try {
      if (!data) {
        alert("No expense data to export.");
        return;
      }

      const XLSX = (await import(/* @vite-ignore */ "xlsx")) as any;

      const detail = data.detail ?? [];
      if (!detail.length) {
        alert(
          "The server did not return per-employee monthly detail.\n" +
            "Make sure /equity/expenses/ returns a 'detail' array."
        );
        return;
      }

      // Monthly Detail sheet
      const monthlyDetailRows = detail.map((row) => ({
        Name: row.name,
        Month: row.month,
        "Monthly Expense ($)": Number(row.expense.toFixed(2)),
      }));
      const wsDetail = XLSX.utils.json_to_sheet(monthlyDetailRows);
      XLSX.utils.sheet_add_aoa(
        wsDetail,
        [["Name", "Month", "Monthly Expense ($)"]],
        { origin: "A1" }
      );

      // Monthly Summary sheet
      const monthlySummaryRows = (data.months || []).map((m) => ({
        Month: m.month,
        "Monthly Expense ($)": Number(m.expense.toFixed(2)),
      }));
      const wsSummary = XLSX.utils.json_to_sheet(monthlySummaryRows);
      XLSX.utils.sheet_add_aoa(
        wsSummary,
        [["Month", "Monthly Expense ($)"]],
        { origin: "A1" }
      );

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsDetail, "Monthly Detail");
      XLSX.utils.book_append_sheet(wb, wsSummary, "Monthly Summary");
      XLSX.writeFile(wb, "Company_Expenses_Export.xlsx");
    } catch (err: any) {
      console.error(err);
      alert(
        typeof err?.message === "string" ? err.message : "Export failed."
      );
    }
  }

  const monthsTracked = data?.months?.length ?? 0;
  const windowLabel =
    data && data.start_month && data.end_month
      ? `${data.start_month} to ${data.end_month}`
      : "N/A";

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-4 px-6">
      <div className="w-full">
        <section className="bg-white rounded-xl shadow-lg overflow-hidden w-full ring-1 ring-black/5">
          {/* Header section (matches Cap Table style) */}
          <div className="px-8 py-6 border-b border-gray-100">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                  Company Stock Comp Expenses
                </h1>
                <p className="mt-1 text-sm text-gray-600">
                  Monthly fair value expense aggregation across all grants.
                </p>
              </div>

              <div className="flex items-center gap-3 self-start md:self-auto">
                <button
                  onClick={load}
                  disabled={loading}
                  className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium shadow-sm hover:bg-indigo-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  {loading ? "Loading…" : "Refresh"}
                </button>

                <button
                  onClick={exportExpensesExcel}
                  disabled={loading || !data}
                  className="inline-flex items-center px-4 py-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm font-medium shadow-sm hover:bg-indigo-50 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  aria-label="Export expenses to Excel"
                  title="Download Monthly Detail & Monthly Summary as Excel"
                >
                  Export Expenses
                </button>
              </div>
            </div>

            {/* error / note inline with header like Cap Table filter area */}
            <div className="mt-4 space-y-2">
              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              {note && !error && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {note}
                </div>
              )}
            </div>
          </div>

          {/* Body section */}
          <div className="px-8 py-6">
            {/* Loading skeleton */}
            {loading && (
              <div className="space-y-4">
                <div className="h-24 rounded-lg bg-slate-100 animate-pulse" />
                <div className="h-64 rounded-lg bg-slate-100 animate-pulse" />
              </div>
            )}

            {!loading && data && (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                  <div className="rounded-lg border border-gray-200 p-5 shadow-sm">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Total Expenses
                    </div>
                    <div className="mt-2 text-2xl font-bold text-gray-900">
                      ${formatCurrency(data.total_expense_fair_value)}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">All time</div>
                  </div>

                  <div className="rounded-lg border border-gray-200 p-5 shadow-sm">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Months Tracked
                    </div>
                    <div className="mt-2 text-2xl font-bold text-gray-900">
                      {monthsTracked}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {windowLabel}
                    </div>
                  </div>
                </div>

                {/* Monthly table */}
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-900">
                      Monthly Expense Schedule
                    </span>
                    <span className="text-xs text-gray-500">
                      Same totals used in the Monthly Summary export sheet
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            Month
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            Expense
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {data.months.map((m) => (
                          <tr key={m.month}>
                            <td className="px-4 py-3 text-sm text-gray-900">
                              {m.month}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">
                              ${formatCurrency(m.expense)}
                            </td>
                          </tr>
                        ))}

                        {data.months.length === 0 && (
                          <tr>
                            <td
                              colSpan={2}
                              className="px-4 py-4 text-center text-sm text-gray-500"
                            >
                              No expense data available for this window.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ===== helpers ===== */

function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0.00";
  return value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function apiErr(e: any) {
  const d = e?.response?.data;
  if (!d) return "Request failed.";
  if (typeof d === "string") return d;
  if ((d as any).detail) return (d as any).detail;
  return Object.entries(d as Record<string, any>)
    .map(([k, v]) =>
      `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`
    )
    .join(" ");
}