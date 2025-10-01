import React from "react";
import { Outlet } from "react-router-dom";
import EmployerTaskbar from "./EmployerTaskbar";
import "../styles/employer.css"; // <-- make sure this path matches where your CSS lives

export default function EmployerLayout() {
  return (
    <div className="emp-layout">
      <EmployerTaskbar />
      <main className="emp-content">
        <Outlet />
      </main>
    </div>
  );
}