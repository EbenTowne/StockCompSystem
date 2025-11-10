//todo
//change taskbar title to Stock Comp Expense

import React, { useEffect, useState } from "react";

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

  const apiBase = "/api/equity/expenses/"; // aggregated monthly expenses endpoint (GET)

  async function fetchAggregated() {
    setLoading(true);
    setError(null);
    try {
      // mirror token/credentials strategy used elsewhere in the app
      const token =
        localStorage.getItem("access") ||
        localStorage.getItem("accessToken") ||
        localStorage.getItem("token") ||
        localStorage.getItem("jwt");
      const headers: Record<string, string> = { "Accept": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(apiBase, { credentials: "include", headers });
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const json = await res.json();
      setData(json as CompanyExpenses);
    } catch (err: any) {
      setError(err.message || "Unknown error");
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
    <div style={{ padding: 16 }}>
      <h2>Company Expenses (Monthly)</h2>

      <div style={{ marginBottom: 12 }}>
        <button onClick={fetchAggregated} disabled={loading}>
          Refresh
        </button>
      </div>

      {loading && <div>Loading...</div>}

      {error && (
        <div style={{ color: "#b00020", marginBottom: 12 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {!loading && data && (
        <div>
          <div style={{ marginBottom: 8 }}>
            <strong>Company ID:</strong> {data.company_id}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong>Window:</strong> {data.start_month} → {data.end_month}
          </div>
          <div style={{ marginBottom: 12 }}>
            <strong>Total fair value:</strong> ${data.total_expense_fair_value.toFixed(2)}
            {"  "}
            <strong>Grand total (window):</strong> ${data.grand_total_within_window.toFixed(2)}
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={{ padding: 8 }}>Month</th>
                <th style={{ padding: 8, width: 160 }}>Expense</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.month} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: 8 }}>{m.month}</td>
                  <td style={{ padding: 8 }}>${m.expense.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !data && !error && <div>No data available.</div>}
    </div>
  );
}