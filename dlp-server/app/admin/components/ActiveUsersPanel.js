"use client";

/**
 * ActiveUsersPanel – shows which employees have the DLP extension active
 * right now (last heartbeat ≤ 15 minutes ago).
 *
 * Data source: GET /api/user-heartbeat
 */

import { useState, useEffect, useCallback } from "react";
import { Users, Wifi, WifiOff, RefreshCw, Clock } from "lucide-react";

function clsx(...cls) { return cls.filter(Boolean).join(" "); }

function timeAgo(dateStr) {
  const diffMs  = Date.now() - new Date(dateStr).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "פחות מדקה";
  if (diffMin < 60) return `לפני ${diffMin} דק'`;
  const diffH = Math.floor(diffMin / 60);
  return `לפני ${diffH} שע'`;
}

export default function ActiveUsersPanel({ apiKey }) {
  const [users,    setUsers]    = useState([]);
  const [count,    setCount]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["x-api-key"] = apiKey;

      const res = await fetch("/api/user-heartbeat", { headers });
      if (!res.ok) {
        setError("לא ניתן לטעון משתמשים פעילים");
        return;
      }
      const data = await res.json();
      setUsers(data.activeUsers || []);
      setCount(data.count || 0);
      setLastRefresh(new Date());
    } catch {
      setError("שגיאת רשת");
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  // Fetch on mount and every 15 seconds
  useEffect(() => {
    fetchUsers();
    const interval = setInterval(fetchUsers, 15_000);
    return () => clearInterval(interval);
  }, [fetchUsers]);

  return (
    <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <Users className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">משתמשים פעילים</h3>
            <p className="text-xs text-slate-500">עם תוסף DLP פעיל (15 דק' אחרונות)</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-xs text-slate-600 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeAgo(lastRefresh)}
            </span>
          )}
          <button
            onClick={fetchUsers}
            disabled={loading}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
            title="רענן"
          >
            <RefreshCw className={clsx("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Count badge */}
      <div className="flex items-center gap-2 mb-4">
        <span className={clsx(
          "text-3xl font-bold",
          count > 0 ? "text-emerald-400" : "text-slate-500"
        )}>
          {loading ? "—" : count}
        </span>
        <span className="text-sm text-slate-400">משתמשים מחוברים</span>
        {count > 0 && (
          <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
            <Wifi className="w-3 h-3" /> פעיל
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-rose-400 mb-3 flex items-center gap-1">
          <WifiOff className="w-3 h-3" /> {error}
        </p>
      )}

      {/* User list */}
      {!loading && !error && users.length === 0 && (
        <p className="text-xs text-slate-500 text-center py-4">
          אין משתמשים פעילים כרגע
        </p>
      )}

      {users.length > 0 && (
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {users.map((u) => (
            <div
              key={u.userEmail}
              className="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                {/* Online indicator */}
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                </span>
                <span className="text-slate-200 truncate">{u.userEmail}</span>
              </div>

              <div className="flex items-center gap-3 shrink-0 ml-2">
                {u.interceptedCount > 0 && (
                  <span className="text-orange-400 font-medium">
                    {u.interceptedCount} חסימות
                  </span>
                )}
                <span className="text-slate-500">{timeAgo(u.lastSeenAt)}</span>
                {u.extensionVersion && (
                  <span className="text-slate-600">v{u.extensionVersion}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
