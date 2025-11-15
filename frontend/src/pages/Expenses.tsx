import React, { useEffect, useState } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL as string;

type MonthEntry = { month: string; expense: number };
type CompanyExpenses = {
  company_id: number;
  start_month: string;
  end_month: string;
  total_expense_fair_value: number;
  months: MonthEntry[];
  grand_total_within_window: number;
};

export default function Expenses() {
  const [data, setData] = useState<CompanyExpenses | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // set up axios auth
  useEffect(() => {
    const access = localStorage.getItem("accessToken");
    if (access) axios.defaults.headers.common["Authorization"] = `Bearer ${access}`;
  }, []);

  async function fetchAggregated() {
    setLoading(true);
    setError(null);
    try {
      const url = `${API}/equity/expenses/`;
      const response = await axios.get<CompanyExpenses>(url);
      setData(response.data);
    } catch (err: any) {
      setError(apiErr(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAggregated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  

  return (
    <div className="min-h-screen bg-indigo-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Company Stock Comp Expense</h1>
            <p className="text-gray-600 mt-1">Monthly fair value expense aggregation across all grants</p>
          </div>

          {/* Controls */}
          <div className="mb-6 flex items-center gap-3">
            <button
              onClick={fetchAggregated}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
            {/* (window selector removed) */}
          </div>

          {/* Error State */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 text-sm">
                <strong>Error:</strong> {error}
              </p>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="text-center py-12">
              <div className="inline-block">
                <div className="animate-spin rounded-full h-8 w-8 border border-indigo-600 border-t-transparent"></div>
              </div>
              <p className="text-gray-600 mt-3">Loading expenses…</p>
            </div>
          )}

          {/* Summary Cards */}
          {!loading && data && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Expenses</div>
                  <div className="text-2xl font-bold text-gray-900 mt-2">
                    ${formatCurrency(data.total_expense_fair_value)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">All time</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Months Tracked</div>
                  <div className="text-2xl font-bold text-gray-900 mt-2">{data.months.length}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {data.start_month} to {data.end_month}
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Month</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wide">Expense</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.months.map((m, idx) => (
                      <tr key={m.month} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        <td className="px-6 py-3 text-sm text-gray-900">{m.month}</td>
                        <td className="px-6 py-3 text-sm text-right font-medium text-gray-900">
                          ${formatCurrency(m.expense)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Empty State */}
          {!loading && !data && !error && (
            <div className="text-center py-12">
              <p className="text-gray-600">No data available.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "0.00";
  return value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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