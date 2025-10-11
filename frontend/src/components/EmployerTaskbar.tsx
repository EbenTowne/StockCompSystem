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
        <NavLink to="invite" className={({ isActive }) => (isActive ? active : linkBase)}>
          Invite New Employee
        </NavLink>
        <NavLink to="create-grant" className={({ isActive }) => (isActive ? active : linkBase)}>
          Create Stock Option Grant
        </NavLink>
        <NavLink to="grants" className={({ isActive }) => (isActive ? active : linkBase)}>
          Manage/View Grants
        </NavLink>
        <NavLink to="cap-table" className={({ isActive }) => (isActive ? active : linkBase)}>
          View Cap Table & Monthly Expenses
        </NavLink>
        {/* Add AI later if you add the page: <NavLink to="ai" ...>AI Assistant</NavLink> */}
      </nav>
    </aside>
  );
}