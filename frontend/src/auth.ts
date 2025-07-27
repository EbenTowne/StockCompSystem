// frontend/src/auth.ts

import axios from 'axios';

/**

 */
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000/api';

/** POST { username, password } → { access, refresh } */
export const login = (username: string, password: string) =>
  axios.post<{ access: string; refresh: string }>(
    `${API_BASE}/token/`,
    { username, password }
  );

/** POST { refresh } → { access } */
export const refreshToken = (refresh: string) =>
  axios.post<{ access: string }>(
    `${API_BASE}/token/refresh/`,
    { refresh }
  );

/** POST { email } → send password‐reset link */
export const forgotPassword = (email: string) =>
  axios.post(
    `${API_BASE}/auth/forgot-password/`,
    { email }
  );

/**
 * POST { uid, token, new_password, re_new_password }
 * → actually reset the password
 */
export const resetPassword = (
  uid: string,
  token: string,
  new_password: string,
  re_new_password: string
) =>
  axios.post(
    `${API_BASE}/auth/reset-password/${uid}/${token}/`,
    { new_password, re_new_password }
  );

/**
 * POST employer sign‐up:
 * { username, name, email, password, companyName, uniqueId }
 */
export const registerEmployer = (data: {
  username: string;
  name: string;
  email: string;
  password: string;
  companyName: string;
  uniqueId: string;
}) =>
  axios.post(
    `${API_BASE}/register/employer/`,
    data
  );
