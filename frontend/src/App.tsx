import React from "react";
import { NavLink } from "react-router-dom";

/**
 
Medium text but tighter vertical padding for a denser feel.*/
const base =
  "block w-full text-left rounded-md px-3 py-1.5 text-base text-gray-200 hover:bg-gray-800 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-indigo-500/50";
const active =
  "block rounded-md px-3 py-1.5 text-base bg-gray-800 text-white font-semibold";

export default function EmployerTaskbar() {
  return (
    <div className="h-full w-full border-r border-gray-800 bg-gray-900">
      <nav className="space-y-1 p-2.5">
        <NavLink to="company-metrics" className={({ isActive }) => (isActive ? active : base)}>
          Company Metrics
        </NavLink>
        <NavLink to="create-grant" className={({ isActive }) => (isActive ? active : base)}>
          Create New Option
        </NavLink>
        <NavLink to="grants" className={({ isActive }) => (isActive ? active : base)}>
          Manage Stock Options
        </NavLink>
        <NavLink to="cap-table" className={({ isActive }) => (isActive ? active : base)}>
          Cap Table
        </NavLink>
        <NavLink to="expenses" className={({ isActive }) => (isActive ? active : base)}>
          Stock Comp Expense
        </NavLink>
        <NavLink to="view-employees" className={({ isActive }) => (isActive ? active : base)}>
          Manage Employees
        </NavLink>

        {/* --- AI Assistant toggle (opens/closes ChatWidget) --- */}
        <button
          type="button"
          onClick={() => {
            // Prefer global hook if ChatWidget exposed it; else fall back to event
            (window as any).chatWidget?.toggle?.() ||
              window.dispatchEvent(new Event("chat:toggle"));
          }}
          className={base}
          title="Open AI Assistant"
          aria-label="Open AI Assistant"
          data-testid="open-ai-assistant"
        >
          AI Assistant
        </button>
      </nav>
    </div>
  );
}