import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios, { AxiosError } from "axios";
import { AuthContext } from "../context/AuthContext";

type Profile = { username?: string; name?: string; email?: string };

// ---------- Config ----------
const RAW_API =
  (import.meta as any)?.env?.VITE_API_URL || "https://stockcompsystem.onrender.com/api";
const API = String(RAW_API).replace(/\/+$/, "");
const PROFILE_PATH = "/accountInfo/";

// Keys your app might use for the access token
const ACCESS_KEYS = ["accessToken", "access", "token", "jwt"];
const NAME_CACHE_KEY = "displayNameCache";
const AUTH_BROADCAST_KEY = "auth:broadcast"; // optional cross-tab notifier

// How often to poll localStorage for token changes (same-tab)
const TOKEN_HEARTBEAT_MS = 800;

// ---------- Helpers ----------
function readAccessToken(): string {
  for (const k of ACCESS_KEYS) {
    const v = localStorage.getItem(k);
    if (v) return v;
  }
  return "";
}
function clearAuthArtifacts() {
  sessionStorage.removeItem(NAME_CACHE_KEY);
}
function naviSafeEmailToName(email?: string | null) {
  if (!email) return "";
  const i = email.indexOf("@");
  return i > 0 ? email.slice(0, i) : email;
}

export default function Header() {
  const navigate = useNavigate();
  const { user, signOut } =
    useContext(AuthContext) ?? ({ user: null, signOut: async () => {} } as any);

  const [token, setToken] = useState<string>(readAccessToken());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAuthed, setIsAuthed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  // ---- Watch token changes (same tab) with a heartbeat + visibility wakeup
  useEffect(() => {
    let alive = true;

    const checkNow = () => {
      if (!alive) return;
      const t = readAccessToken();
      setToken((prev) => (prev !== t ? t : prev));
    };

    const iv = window.setInterval(checkNow, TOKEN_HEARTBEAT_MS);
    const onVis = () => document.visibilityState === "visible" && checkNow();
    document.addEventListener("visibilitychange", onVis);

    // Also re-check immediately on mount
    checkNow();

    return () => {
      alive = false;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // ---- Also react to cross-tab storage changes (if your login code updates storage)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea !== localStorage) return;
      if (ACCESS_KEYS.includes(e.key || "") || e.key === AUTH_BROADCAST_KEY) {
        const t = readAccessToken();
        setToken((prev) => (prev !== t ? t : prev));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ---- Race-proof profile fetch. Only the latest request can win.
  const reqCounter = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const myReqId = ++reqCounter.current;

    const run = async () => {
      // If no token, consider logged out immediately
      if (!token) {
        if (cancelled) return;
        setIsAuthed(false);
        setProfile(null);
        clearAuthArtifacts();
        return;
      }

      setLoading(true);
      try {
        const { data } = await axios.get(`${API}${PROFILE_PATH}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        // Only the most recent request can update state
        if (cancelled || myReqId !== reqCounter.current) return;

        setProfile(data as Profile);
        setIsAuthed(true);
      } catch (err) {
        if (cancelled || myReqId !== reqCounter.current) return;
        const ax = err as AxiosError;

        // Any auth error => hard logout state
        if (ax.response?.status === 401 || ax.response?.status === 403) {
          setIsAuthed(false);
          setProfile(null);
          clearAuthArtifacts();
        } else {
          // Network or other error -> do not claim logged in
          setIsAuthed(false);
          setProfile(null);
          clearAuthArtifacts();
        }
      } finally {
        if (!cancelled && myReqId === reqCounter.current) {
          setLoading(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [token, user?.username, user?.email]);

  // ---- Friendly display name (only while authenticated)
  const displayName = useMemo(() => {
    if (!isAuthed) return "";
    const fromProfile =
      profile?.username ||
      profile?.name ||
      naviSafeEmailToName(profile?.email || "");
    const fromCtx =
      (user as any)?.username ||
      naviSafeEmailToName((user as any)?.email || "");

    const name =
      fromProfile || fromCtx || sessionStorage.getItem(NAME_CACHE_KEY) || "";
    if (name) sessionStorage.setItem(NAME_CACHE_KEY, name);
    return name;
  }, [isAuthed, profile?.username, profile?.name, profile?.email, user]);

  // ---- Sign out
  const handleSignOut = async () => {
    try {
      clearAuthArtifacts();
      await signOut?.();
    } finally {
      // Fallback: if your signOut doesn't clear tokens, do it here
      for (const k of ACCESS_KEYS) localStorage.removeItem(k);
      // Notify any listeners
      localStorage.setItem(AUTH_BROADCAST_KEY, String(Date.now()));
      // Force immediate UI update in this tab
      setToken(readAccessToken());
      setIsAuthed(false);
      setProfile(null);
      navigate("/login");
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-gray-900 text-white shadow">
      <div className="flex h-20 items-center justify-between px-0">
        <Link
          to="/"
          className="pl-4 md:pl-6 font-bold tracking-tight leading-tight hover:text-gray-200"
          style={{ fontSize: "clamp(22px, 2.2vw + 8px, 34px)" }}
          aria-label="Stock Comp System Home"
        >
          Endless Moments Stock Comp
        </Link>

        {!loading && isAuthed ? (
          <div className="flex items-center gap-3 pr-3 md:pr-4">
            {displayName ? (
              <span className="hidden sm:inline text-base text-gray-200">
                Welcome <span className="font-semibold">{displayName}</span>!
              </span>
            ) : null}
            <button
              onClick={handleSignOut}
              className="rounded-lg bg-red-500 px-4 py-2.5 text-base font-semibold shadow-sm hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400"
              aria-label="Sign Out"
            >
              Sign Out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
