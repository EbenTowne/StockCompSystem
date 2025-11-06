// frontend/src/auth.ts
import axios from "axios";

/**
 * API base (your JWT/REST endpoints, includes /api)
 * Ex: http://127.0.0.1:8000/api
 */
export const API_BASE =
  import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000/api";

/**
 * Backend base **without** /api — used for Django's server-rendered pages
 * Ex: http://127.0.0.1:8000
 */
export const BACKEND_BASE =
  import.meta.env.VITE_BACKEND_URL ?? API_BASE.replace(/\/api\/?$/, "");

/* ----------------------------------------------------------------------------
 * Auth helpers
 * --------------------------------------------------------------------------*/

type JwtPair = { access: string; refresh: string };
type AccessOnly = { access: string };

export const login = (username: string, password: string) =>
  axios.post<JwtPair>(`${API_BASE}/token/`, { username, password });

export const refreshToken = (refresh: string) =>
  axios.post<AccessOnly>(`${API_BASE}/token/refresh/`, { refresh });

/** Optionally handy for attaching the bearer token automatically */
const authHeaders = () => {
  const token = localStorage.getItem("access");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/* ----------------------------------------------------------------------------
 * Password flows
 * --------------------------------------------------------------------------*/

export const forgotPassword = (email: string) =>
  axios.post(`${API_BASE}/auth/forgot-password/`, { email });

/**
 * Reset password
 * Backend expects: POST /auth/reset-password/
 * Body: { uidb64, token, new_password }
 */
export const resetPassword = (
  uidb64: string,
  token: string,
  new_password: string
) =>
  axios.post(`${API_BASE}/auth/reset-password/`, {
    uidb64,
    token,
    new_password,
  });

/* ----------------------------------------------------------------------------
 * Registration
 * --------------------------------------------------------------------------*/

export const registerEmployer = (data: {
  username: string;
  name: string;
  email: string;
  password: string;
  company_name: string;
  unique_id: string;
}) => axios.post(`${API_BASE}/register/employer/`, data);

/* ----------------------------------------------------------------------------
 * Account info (used to check if 2FA enabled)
 * --------------------------------------------------------------------------*/

export const getAccountInfo = (accessToken: string) =>
  axios.get(`${API_BASE}/accountInfo/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

/* ----------------------------------------------------------------------------
 * Two-factor (TOTP) helpers
 *   If your backend endpoints are different, adjust the URLs below.
 * --------------------------------------------------------------------------*/

export type Start2FAResponse = { otpauth_url: string; secret?: string };
export type Verify2FAResponse = { detail?: string };

export const startTwoFactorSetup = () =>
  axios.post<Start2FAResponse>(
    `${API_BASE}/2fa/start/`,
    {},
    { headers: authHeaders() }
  );

export const verifyTwoFactorToken = (code: string) =>
  axios.post<Verify2FAResponse>(
    `${API_BASE}/2fa/verify/`,
    { code },
    { headers: authHeaders() }
  );

/* ----------------------------------------------------------------------------
 * Server-rendered 2FA portal & login URL (Django templates)
 * --------------------------------------------------------------------------*/

export const openTwoFactorPortal = () => {
  window.open(`${BACKEND_BASE}/account/two_factor/`, "_blank", "noopener");
};

export const twoFactorLoginUrl = () => `${BACKEND_BASE}/account/login/`;