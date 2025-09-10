// frontend/src/pages/Enable2FAPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";


import {
  startTwoFactorSetup,
  verifyTwoFactorToken,
} from "../auth";

// Response shapes (align with the backend)
type OtpAuthResponse = {
  otpauth_url: string;
  // secret?: string; // add if your backend returns it and you want to show it
};

type VerifyResponse = {
  detail?: string;
};

type QrLevel = "L" | "M" | "Q" | "H";
const CODE_LEN = 6;

export default function Enable2FAPage(): JSX.Element {
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [qrLevel] = useState<QrLevel>("M");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const { data } = await startTwoFactorSetup(); // ← no generics
        if (!cancelled) setOtpauthUrl(data.otpauth_url);
      } catch (e: unknown) {
        if (!cancelled) setError("Failed to initialize 2FA. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const isCodeValid = useMemo(
    () => /^[0-9]{6}$/.test(code.trim()),
    [code]
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isCodeValid) return;

    try {
      setSubmitting(true);
      setError(null);
      setSuccess(null);

      const { data } = await verifyTwoFactorToken(code.trim()); // ← no generics
      setSuccess(data?.detail ?? "Two-factor authentication is now enabled!");
    } catch (e: unknown) {
      setError("Invalid code. Please check the 6-digit code and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function onCopy() {
    if (!otpauthUrl) return;
    void navigator.clipboard.writeText(otpauthUrl);
    setSuccess("Copied setup URL to clipboard.");
    setTimeout(() => setSuccess(null), 2000);
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <h1 style={styles.h1}>Enable Two-Factor Authentication</h1>

        {loading && <p>Creating your TOTP secret…</p>}
        {error && <p style={styles.error}>{error}</p>}
        {success && <p style={styles.success}>{success}</p>}

        {otpauthUrl && (
          <>
            <div style={styles.qrBox}>
              <QRCodeSVG
                value={otpauthUrl}
                size={196}
                includeMargin
                level={qrLevel}
              />
            </div>

            <p>
              Scan this QR code in your authenticator app (Google Authenticator,
              1Password, Authy, etc.), then enter the 6-digit code below.
            </p>

            <button type="button" onClick={onCopy} style={styles.copyBtn}>
              Copy otpauth:// URL
            </button>
          </>
        )}

        <form onSubmit={onSubmit} style={styles.form}>
          <label htmlFor="code">6-digit code</label>
          <input
            id="code"
            inputMode="numeric"
            pattern="\d*"
            maxLength={CODE_LEN}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            style={styles.input}
          />
          <button
            type="submit"
            disabled={!isCodeValid || submitting}
            style={styles.submit}
          >
            {submitting ? "Verifying…" : "Verify & Enable 2FA"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background: "#0a0a0a",
    color: "#e6e6e6",
    padding: "2rem",
  },
  card: {
    width: "100%",
    maxWidth: 480,
    background: "#141414",
    border: "1px solid #222",
    borderRadius: 16,
    padding: 24,
    boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
  },
  h1: { margin: "0 0 12px", fontSize: 22, fontWeight: 700 },
  qrBox: {
    display: "grid",
    placeItems: "center",
    padding: 16,
    background: "#0f0f0f",
    border: "1px dashed #333",
    borderRadius: 12,
    margin: "12px 0 18px",
  },
  form: { display: "grid", gap: 10, marginTop: 8 },
  input: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #333",
    background: "#0f0f0f",
    color: "#fff",
    letterSpacing: "0.1em",
    fontSize: 16,
  },
  submit: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #2f6",
    background: "#0a2815",
    color: "#b6ffcc",
    cursor: "pointer",
  },
  copyBtn: {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid #444",
    background: "#101010",
    color: "#ddd",
    cursor: "pointer",
    marginBottom: 8,
  },
  error: { color: "#ff6b6b" },
  success: { color: "#6bff9a" },
};
