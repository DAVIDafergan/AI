"use client";

// לוח התראות אבטחה בזמן אמת
import { useState, useEffect, useCallback } from "react";
import { Bell, CheckCircle, AlertTriangle, ShieldAlert, Info } from "lucide-react";

const SEVERITY_STYLES = {
  critical: { bg: "bg-rose-500/20", text: "text-rose-400", border: "border-rose-500/40", icon: ShieldAlert },
  high:     { bg: "bg-orange-500/20", text: "text-orange-400", border: "border-orange-500/40", icon: AlertTriangle },
  medium:   { bg: "bg-yellow-500/20", text: "text-yellow-400", border: "border-yellow-500/40", icon: AlertTriangle },
  low:      { bg: "bg-blue-500/20", text: "text-blue-400", border: "border-blue-500/40", icon: Info },
};

function AlertItem({ alert, onMarkRead }) {
  const s = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.low;
  const SeverityIcon = s.icon;

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-xl border transition-all ${s.border} ${
        alert.read ? "opacity-60 bg-slate-800/30" : `${s.bg}`
      }`}
    >
      <SeverityIcon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${s.text}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${alert.read ? "text-slate-400" : "text-white"}`}>
          {alert.message}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-xs px-2 py-0.5 rounded-full ${s.bg} ${s.text} font-medium`}>
            {alert.severity}
          </span>
          <span className="text-xs text-slate-500">
            {new Date(alert.createdAt).toLocaleString("he-IL")}
          </span>
        </div>
      </div>
      {!alert.read && (
        <button
          onClick={() => onMarkRead(alert.id)}
          title="סמן כנקרא"
          className="text-slate-500 hover:text-emerald-400 transition-colors flex-shrink-0"
        >
          <CheckCircle className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}

export default function AlertsPanel() {
  const [alerts, setAlerts] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts");
      if (!res.ok) return;
      const data = await res.json();
      setAlerts(data.alerts || []);
      setUnreadCount(data.unreadCount || 0);
    } catch {
      // שגיאת רשת – המשך ללא עדכון
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 10000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  async function handleMarkRead(alertId) {
    try {
      await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId }),
      });
      setAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, read: true } : a))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // התעלם משגיאה
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-700/50 rounded-xl shadow-lg">
      {/* כותרת */}
      <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Bell className="w-6 h-6 text-white" />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </div>
          <h3 className="text-white font-semibold text-lg">התראות אבטחה</h3>
        </div>
        {unreadCount > 0 && (
          <span className="text-xs text-rose-400 font-medium">
            {unreadCount} לא נקראות
          </span>
        )}
      </div>

      {/* רשימת התראות */}
      <div className="p-4 space-y-3 max-h-[600px] overflow-y-auto">
        {loading ? (
          <div className="text-center text-slate-400 py-8">טוען התראות...</div>
        ) : alerts.length === 0 ? (
          <div className="text-center text-slate-400 py-12">
            <CheckCircle className="w-12 h-12 mx-auto mb-3 text-emerald-500/50" />
            <p>אין התראות פעילות</p>
          </div>
        ) : (
          alerts.map((alert) => (
            <AlertItem key={alert.id} alert={alert} onMarkRead={handleMarkRead} />
          ))
        )}
      </div>
    </div>
  );
}
