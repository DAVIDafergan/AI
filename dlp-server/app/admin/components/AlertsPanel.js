"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, BellOff, AlertTriangle, Zap, ShieldAlert } from "lucide-react";

const SEVERITY_STYLES = {
  high:   { bg: "bg-rose-500/15 border-rose-500/40",   text: "text-rose-400",   icon: ShieldAlert },
  medium: { bg: "bg-amber-500/15 border-amber-500/40",  text: "text-amber-400",  icon: AlertTriangle },
  low:    { bg: "bg-blue-500/15 border-blue-500/40",    text: "text-blue-400",   icon: Zap },
};

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

export default function AlertsPanel() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts");
      if (!res.ok) return;
      const data = await res.json();
      setAlerts(data.alerts || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 15000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  async function handleMarkRead(id) {
    try {
      await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, read: true } : a));
    } catch { /* ignore */ }
  }

  async function handleMarkAllRead() {
    const unread = alerts.filter(a => !a.read);
    await Promise.all(unread.map(a => handleMarkRead(a.id)));
  }

  const unreadCount = alerts.filter(a => !a.read).length;

  return (
    <div className="bg-slate-900 border border-slate-700/50 rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between p-6 cursor-pointer select-none border-b border-slate-700/50"
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="flex items-center gap-2">
          {unreadCount > 0 ? (
            <Bell className="w-5 h-5 text-rose-400 animate-pulse" />
          ) : (
            <BellOff className="w-5 h-5 text-slate-500" />
          )}
          <h3 className="text-white font-semibold text-lg">התראות</h3>
          {unreadCount > 0 && (
            <span className="text-xs bg-rose-500 text-white rounded-full px-2 py-0.5 font-bold">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={e => { e.stopPropagation(); handleMarkAllRead(); }}
              className="text-xs text-slate-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-slate-800"
            >
              סמן הכל כנקרא
            </button>
          )}
          <span className="text-slate-500 text-sm">{collapsed ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="p-4">
          {loading ? (
            <p className="text-slate-500 text-sm text-center py-4">טוען התראות...</p>
          ) : alerts.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-6">אין התראות פעילות</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {alerts.map(alert => {
                const style = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.low;
                const Icon = style.icon;
                return (
                  <div
                    key={alert.id}
                    className={`flex items-start gap-3 p-3 rounded-xl border transition-opacity ${style.bg} ${alert.read ? "opacity-50" : ""}`}
                  >
                    <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${style.text}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${style.text}`}>{alert.message}</p>
                      <p className="text-slate-500 text-xs mt-0.5">{formatTime(alert.timestamp)}</p>
                    </div>
                    {!alert.read && (
                      <button
                        onClick={() => handleMarkRead(alert.id)}
                        className="text-slate-500 hover:text-white text-xs whitespace-nowrap transition-colors"
                      >
                        ✓ נקרא
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
