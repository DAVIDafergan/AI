"use client";

import { useEffect, useRef, useState } from "react";
import { Radio, Pause, Play, Filter } from "lucide-react";

const SEVERITY_STYLES = {
  critical: "text-red-400 border-red-900/40 bg-red-950/30",
  high:     "text-orange-400 border-orange-900/40 bg-orange-950/20",
  medium:   "text-yellow-400 border-yellow-900/40 bg-yellow-950/20",
  low:      "text-slate-400 border-slate-700/40 bg-slate-900/30",
};

const EVENT_TYPE_LABELS = {
  scan:             "סריקה",
  block:            "חסימה",
  alert:            "התראה",
  agent_connect:    "חיבור סוכן",
  agent_disconnect: "ניתוק סוכן",
  agent_provision_error: "שגיאת התקנת סוכן",
  config_change:    "שינוי הגדרות",
  user_action:      "פעולת משתמש",
};

export default function LiveEventsStream({ superAdminKey }) {
  const [events, setEvents]       = useState([]);
  const [paused, setPaused]       = useState(false);
  const [filters, setFilters]     = useState({ severity: "", eventType: "" });
  const [showFilter, setShowFilter] = useState(false);
  const listRef = useRef(null);
  const pausedRef = useRef(false);

  pausedRef.current = paused;

  const fetchEvents = async () => {
    if (pausedRef.current) return;
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (filters.severity) params.set("severity", filters.severity);
      if (filters.eventType) params.set("eventType", filters.eventType);
      const res = await fetch(`/api/tenant-events?${params}`, {
        headers: { "x-super-admin-key": superAdminKey },
      });
      if (!res.ok) return;
      const data = await res.json();
      setEvents(data.events || []);
    } catch {}
  };

  useEffect(() => {
    fetchEvents();
    const iv = setInterval(fetchEvents, 3000);
    return () => clearInterval(iv);
  }, [filters, superAdminKey]);

  // auto-scroll
  useEffect(() => {
    if (!paused && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [events, paused]);

  return (
    <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl overflow-hidden flex flex-col h-96">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/40 shrink-0">
        <div className="flex items-center gap-2">
          <Radio size={14} className="text-red-400 animate-pulse" />
          <span className="text-sm text-slate-200 font-medium">אירועים חיים</span>
          <span className="text-xs text-slate-600">{events.length} אירועים</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowFilter(!showFilter)} className={`p-1.5 rounded transition-colors ${showFilter ? "text-cyan-400" : "text-slate-500 hover:text-slate-300"}`}>
            <Filter size={13} />
          </button>
          <button
            onClick={() => setPaused((p) => !p)}
            className={`p-1.5 rounded transition-colors ${paused ? "text-yellow-400" : "text-slate-500 hover:text-slate-300"}`}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilter && (
        <div className="flex gap-3 px-4 py-2 border-b border-slate-800 shrink-0">
          <select
            value={filters.severity}
            onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))}
            className="bg-slate-900 border border-slate-700/60 rounded text-xs text-slate-300 px-2 py-1 outline-none"
          >
            <option value="">כל החומרות</option>
            {["low","medium","high","critical"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={filters.eventType}
            onChange={(e) => setFilters((f) => ({ ...f, eventType: e.target.value }))}
            className="bg-slate-900 border border-slate-700/60 rounded text-xs text-slate-300 px-2 py-1 outline-none"
          >
            <option value="">כל הסוגים</option>
            {Object.keys(EVENT_TYPE_LABELS).map((t) => <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
      )}

      {/* Events list */}
      <div
        ref={listRef}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className="flex-1 overflow-y-auto"
      >
        {events.length === 0 ? (
          <p className="text-center text-slate-600 text-xs py-8">אין אירועים</p>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {events.map((e) => {
              const style = SEVERITY_STYLES[e.severity] || SEVERITY_STYLES.low;
              return (
                <div key={e._id} className={`px-4 py-2.5 border-r-2 ${style}`}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium">{EVENT_TYPE_LABELS[e.eventType] || e.eventType}</span>
                    <span className="text-xs opacity-60">
                      {e.timestamp ? new Date(e.timestamp).toLocaleTimeString("he-IL") : ""}
                    </span>
                  </div>
                  <div className="text-xs opacity-70 truncate">
                    {e.userEmail && <span className="mr-2">👤 {e.userEmail}</span>}
                    {e.category && <span className="mr-2">📂 {e.category}</span>}
                    {e.ip && <span>🌐 {e.ip}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {paused && (
        <div className="px-4 py-1.5 bg-yellow-900/20 border-t border-yellow-800/40 text-xs text-yellow-400 shrink-0">
          גלילה מושהית – העבר את העכבר לחידוש
        </div>
      )}
    </div>
  );
}
