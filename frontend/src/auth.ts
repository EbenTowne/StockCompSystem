import axios from 'axios';

/** 
 * CRA exposes variables that start with REACT_APP_ on process.env.
 *  – create a .env file in /frontend with:
 *        REACT_APP_API_URL=http://127.0.0.1:8000/api
 *  – if it’s missing, we fall back to localhost:8000/api
 */
const API =
  process.env.REACT_APP_API_URL ?? 'http://127.0.0.1:8000/api';

/* ─────────────── auth ─────────────── */

export const login = (username: string, password: string) =>
  axios.post(`${API}/token/`, { username, password });

export const refreshToken = (refresh: string) =>
  axios.post(`${API}/token/refresh/`, { refresh });

/* ────── employer sign-up ────── */

export const registerEmployer = (
  username: string,
  name: string,
  email: string,
  password: string,
  companyName: string,
  uniqueId: string,
) =>
  axios.post(`${API}/register/employer/`, {
    username,
    name,
    email,
    password,
    company_name: companyName,
    unique_id: uniqueId,
  });

/* ────── password flows ────── */

export const forgotPassword = (email: string) =>
  axios.post(`${API}/auth/forgot-password/`, { email });

export const resetPassword = (
  uidb64: string,
  token: string,
  newPassword: string,
) =>
  axios.post(`${API}/auth/reset-password/`, {
    uidb64,
    token,
    new_password: newPassword,
  });

export const changePassword = (
  oldPassword: string,
  newPassword: string,
  jwt: string,
) =>
  axios.post(
    `${API}/auth/change-password/`,
    { old_password: oldPassword, new_password: newPassword },
    { headers: { Authorization: `Bearer ${jwt}` } },
  );
