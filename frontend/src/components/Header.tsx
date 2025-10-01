import React, { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { AuthContext } from "../context/AuthContext";

type Profile = { username?: string; name?: string; email?: string };

// Base URL from .env (fallback to localhost:8000), strip trailing slashes
const RAW_API = (import.meta as any)?.env?.VITE_API_URL || "http://127.0.0.1:8000";
const API = String(RAW_API).replace(/\/+$/, "");

// Your DRF path is /api/accountInfo/  (per screenshot)
const PROFILE_PATH = "/api/accountInfo/";

export default function Header() {
  const { user, signOut } = useContext(AuthContext)!;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const access =
          localStorage.getItem("accessToken") || localStorage.getItem("access") || "";
        const headers = access ? { Authorization: `Bearer ${access}` } : undefined;

        const { data } = await axios.get(`${API}${PROFILE_PATH}`, {
          headers,
          withCredentials: false, // set true only if you use cookie auth
        });

        if (!cancelled) setProfile(data as Profile);
      } catch {
        if (!cancelled) setProfile(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Prefer username from API; then context; then email prefix; finally "there"
  const displayName =
    profile?.username ||
    user?.username ||
    profile?.name ||
    (profile?.email ? profile.email.split("@")[0] : "") ||
    (user?.email ? user.email.split("@")[0] : "") ||
    "there";

  return (
    <header className="px-6 py-4 bg-gray-800 text-white flex justify-between items-center shadow-md">
      <Link to="/" className="text-2xl font-bold hover:text-gray-300">
        Stock Comp System
      </Link>

      {(user || profile) && !loading ? (
        <div className="flex items-center space-x-4">
          <span className="text-lg">Welcome {displayName}!</span>
          <button
            onClick={signOut}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 rounded transition"
          >
            Sign Out
          </button>
        </div>
      ) : (
        <Link to="/login" className="text-indigo-400 hover:text-indigo-300 font-medium">
          Sign In
        </Link>
      )}
    </header>
  );
}