import React from "react";
import { NavLink } from "react-router-dom";

const linkBase = "emp-link";
const active = "emp-link active";

export default function EmployerTaskbar() {
  return (
    <aside className="emp-sidebar">
      <nav className="emp-sidebar__nav">
        <NavLink to="" end className={({ isActive }) => (isActive ? active : linkBase)}>
          Overview
        </NavLink>
        <NavLink to="company-metrics" className={({ isActive }) => (isActive ? active : linkBase)}>
          Company Metrics
        </NavLink>
        <NavLink to="create-grant" className={({ isActive }) => (isActive ? active : linkBase)}>
          Create Stock Option
        </NavLink>
        <NavLink to="grants" className={({ isActive }) => (isActive ? active : linkBase)}>
          Manage Stock Options
        </NavLink>
        <NavLink to="cap-table" className={({ isActive }) => (isActive ? active : linkBase)}>
          Cap Table
        </NavLink>
        <NavLink to="expenses" className={({ isActive }) => (isActive ? active : linkBase)}>
          Expenses
        </NavLink>
        <NavLink to="invite" className={({ isActive }) => (isActive ? active : linkBase)}>
          Invite Employee
        </NavLink>
        <NavLink to="view-employees" className={({ isActive }) => (isActive ? active : linkBase)}>
          View Employees
        </NavLink>
        <NavLink to="ai-chatbot" className={({ isActive }) => (isActive ? active : linkBase)}>
          AI Chatbot
        </NavLink>
      </nav>
    </aside>
  );
}