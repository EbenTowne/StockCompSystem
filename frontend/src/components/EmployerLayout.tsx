import React from "react";
import { Outlet } from "react-router-dom";
import EmployerTaskbar from "./EmployerTaskbar";
import ChatWidget from "./ChatWidget"; // ← added

/**
 * Full-bleed layout:
 * - Header is rendered globally (above), sidebar is sticky below it.
 * - Content runs flush from the right edge of the sidebar to the window edge.
 * - No centered container, no horizontal padding/margins.
 */

const HEADER_PX = 80; // header h-20

export default function EmployerLayout() {
  return (
    <div className="min-h-screen w-full bg-gray-100 text-gray-900">
      <div className="flex w-full">
        {/* Sidebar: attached to the header */}
        <aside
          id="emp-sidebar-aside"
          className="sticky top-20 h-[calc(100vh-80px)] w-56 md:w-60 lg:w-64 shrink-0"
        >
          <EmployerTaskbar />
        </aside>

        {/* Content: full width, no left/right space */}
        <main
          className="flex-1 overflow-x-hidden"
          style={{ paddingTop: 8 }} // tiny breathing room; set to 0 if you want perfectly flush
        >
          <div className="w-full">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mount once so it overlays every page and listens for taskbar toggle */}
      <ChatWidget /> {/* ← added */}
    </div>
  );
}