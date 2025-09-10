// frontend/src/components/TwoFactorCard.tsx
import React from "react";
import { openTwoFactorPortal, twoFactorLoginUrl } from "../auth";

export default function TwoFactorCard({
  enabled,
  onRefresh,
}: {
  enabled: boolean | null;
  onRefresh?: () => void;
}) {
  const label = enabled === null ? "Loading…" : enabled ? "Enabled" : "Disabled";
  const actionText = enabled ? "Disable 2FA" : "Enable 2FA";

  const onClick = () => {
    openTwoFactorPortal();
    // optional: try reloading profile shortly after opening portal
    if (onRefresh) setTimeout(onRefresh, 1000);
  };

  return (
    <div className="rounded-2xl border p-4 shadow-sm">
      <h3 className="text-lg font-semibold mb-1">Two-Factor Authentication</h3>
      <p className="text-sm mb-3">
        Status: <span className="font-medium">{label}</span>
      </p>
      <div className="flex gap-3">
        <button onClick={onClick} className="px-3 py-2 rounded-xl border">
          {actionText}
        </button>
        <a
          href={twoFactorLoginUrl()}
          target="_blank"
          rel="noreferrer"
          className="px-3 py-2 rounded-xl border"
        >
          Open 2FA Login
        </a>
      </div>
      <p className="text-xs text-gray-500 mt-3">
        Setup/Disable opens a secure server page to scan a QR and manage backup codes.
      </p>
    </div>
  );
}
