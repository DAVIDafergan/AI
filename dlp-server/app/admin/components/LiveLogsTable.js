"use client";

import { useState, useMemo } from "react";
import { Search, Filter } from "lucide-react";

// צבעי נקודה לפי סוג מידע
const TYPE_COLORS = {
  "כרטיס אשראי": "#f43f5e",
  "תעודת זהות": "#8b5cf6",
  "אימייל": "#3b82f6",
  "טלפון נייד": "#22c55e",
  "טלפון נייח": "#10b981",
  "מילות מפתח": "#f59e0b",
  "IBAN": "#06b6d4",
  "כתובת IP": "#ec4899",
  "דרכון": "#a78bfa",
  "מספר רכב": "#fb923c",
  "תאריך לידה": "#84cc16",
  "כתובת": "#e879f9",
  "שם מלא": "#38bdf8",
  "סיסמה": "#ef4444",
  "חשבון בנק": "#fbbf24",
  "כלל מותאם": "#94a3b8",
};

function formatTime(timestamp) {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return timestamp;
  }
}

function ThreatBadge({ score }) {
  if (score == null) return null;
  const color = score >= 70 ? "bg-rose-500/20 text-rose-400" : score >= 40 ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400";
  return (
    <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${color}`}>
      {score}
    </span>
  );
}

export default function LiveLogsTable({ logs }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // unique categories
  const categories = useMemo(() => {
    if (!logs) return [];
    const set = new Set(logs.map(l => l.type || l.category).filter(Boolean));
    return Array.from(set);
  }, [logs]);

  const filtered = useMemo(() => {
    if (!logs) return [];
    return logs.filter(log => {
      const matchesSearch = !search || [log.type, log.synthetic, log.placeholder, log.source]
        .filter(Boolean)
        .some(v => v.toLowerCase().includes(search.toLowerCase()));
      const matchesCat = categoryFilter === "all" || (log.type || log.category) === categoryFilter;
      return matchesSearch && matchesCat;
    });
  }, [logs, search, categoryFilter]);

  if (!logs || logs.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-6 text-center text-slate-400">
        אין לוגים להצגה – לאחר שתשלח טקסט דרך ה-API, הנתונים יופיעו כאן.
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden shadow-lg">
      {/* Header + Filters */}
      <div className="p-6 border-b border-slate-700/50 space-y-3">
        <h3 className="text-white font-semibold text-lg">לוגים אחרונים</h3>
        <div className="flex flex-col sm:flex-row gap-2">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש בלוגים..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pr-9 pl-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
            />
          </div>
          {/* Category filter */}
          <div className="relative">
            <Filter className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg pr-9 pl-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/50 appearance-none"
            >
              <option value="all">כל הקטגוריות</option>
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        {filtered.length !== logs.length && (
          <p className="text-slate-500 text-xs">מציג {filtered.length} מתוך {logs.length} לוגים</p>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="p-6 text-center text-slate-500 text-sm">אין תוצאות לחיפוש זה</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">#</th>
                <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">זמן</th>
                <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">סוג מידע</th>
                <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">נתון סינתטי</th>
                <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">מקור</th>
                <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">סיכון</th>
                <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log) => (
                <tr
                  key={log.id}
                  className="border-b border-slate-700/30 hover:bg-slate-800/50 transition-colors"
                >
                  <td className="px-4 py-3 text-slate-500 text-sm">{log.id}</td>
                  <td className="px-4 py-3 text-slate-400 text-sm whitespace-nowrap">
                    {formatTime(log.timestamp)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: TYPE_COLORS[log.type] || "#94a3b8" }}
                      />
                      <span className="text-white text-sm whitespace-nowrap">{log.type}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs bg-slate-800 text-amber-400 px-2 py-1 rounded font-mono">
                      {log.synthetic || log.placeholder}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-sm whitespace-nowrap">
                    {log.source || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <ThreatBadge score={log.threatScore} />
                  </td>
                  <td className="px-4 py-3">
                    {log.status === "blocked" ? (
                      <span className="text-xs font-medium px-2 py-1 rounded-full bg-rose-500/20 text-rose-400">
                        נחסם
                      </span>
                    ) : (
                      <span className="text-xs font-medium px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400">
                        מותר
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
