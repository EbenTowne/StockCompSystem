import React from "react";
import { NavLink } from "react-router-dom";

/**
 * Medium text but tighter vertical padding for a denser feel.
 */

const base =
  "block rounded-md px-3 py-1.5 text-base text-gray-200 hover:bg-gray-800 hover:text-white transition";
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
          Expenses
        </NavLink>
        <NavLink to="view-employees" className={({ isActive }) => (isActive ? active : base)}>
          Manage Employees
        </NavLink>
      </nav>
    </div>
  );
}