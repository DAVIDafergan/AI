"use client";

import { useState, useEffect, useCallback } from "react";

// ── Risk level helpers ──
const RISK_CONFIG = {
  low:      { label: "נמוך",    color: "bg-green-500/20 text-green-400 border-green-500/40",    dot: "bg-green-400"   },
  medium:   { label: "בינוני",  color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40", dot: "bg-yellow-400"  },
  high:     { label: "גבוה",    color: "bg-orange-500/20 text-orange-400 border-orange-500/40", dot: "bg-orange-400"  },
  critical: { label: "קריטי",   color: "bg-red-500/20 text-red-400 border-red-500/40",          dot: "bg-red-400"     },
};

function RiskBadge({ level }) {
  const cfg = RISK_CONFIG[level] || RISK_CONFIG.low;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function relativeTime(isoString) {
  if (!isoString) return "—";
  const diff = Date.now() - new Date(isoString).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `לפני ${s} שניות`;
  const m = Math.floor(s / 60);
  if (m < 60) return `לפני ${m} דקות`;
  const h = Math.floor(m / 60);
  if (h < 24) return `לפני ${h} שעות`;
  const d = Math.floor(h / 24);
  return `לפני ${d} ימים`;
}

export default function UsersTable() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedEmail, setExpandedEmail] = useState(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/stats?view=users");
      if (!res.ok) return;
      const data = await res.json();
      // sort by risk level severity then totalBlocks
      const ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
      const sorted = (data.users || []).sort((a, b) => {
        const diff = (ORDER[a.riskLevel] ?? 4) - (ORDER[b.riskLevel] ?? 4);
        return diff !== 0 ? diff : b.totalBlocks - a.totalBlocks;
      });
      setUsers(sorted);
    } catch {
      // שגיאת רשת – שמור נתונים קיימים
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    const interval = setInterval(fetchUsers, 10000);
    return () => clearInterval(interval);
  }, [fetchUsers]);

  const filtered = users.filter((u) =>
    !search || u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          👥 ניהול משתמשים
          <span className="text-sm font-normal text-slate-400">({users.length} משתמשים)</span>
        </h2>
        <input
          type="text"
          placeholder="חיפוש לפי אימייל..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500 w-full sm:w-64"
          dir="ltr"
        />
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-slate-900 border border-slate-700/50 rounded-xl h-14" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-8 text-center text-slate-400">
          {search ? "לא נמצאו משתמשים התואמים את החיפוש" : "אין משתמשים רשומים עדיין"}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60 border-b border-slate-700/50">
                <th className="text-right px-4 py-3 font-semibold text-slate-300">אימייל</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-300">חסימות</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-300">רמת סיכון</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-300">פעילות אחרונה</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-300">קטגוריה עיקרית</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-300">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <>
                  <tr
                    key={user.email}
                    onClick={() => setExpandedEmail(expandedEmail === user.email ? null : user.email)}
                    className="border-b border-slate-800 hover:bg-slate-800/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-slate-200 font-mono text-xs" dir="ltr">
                      {user.email}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-lg font-bold text-white">{user.totalBlocks}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <RiskBadge level={user.riskLevel} />
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {relativeTime(user.lastActivity)}
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs">
                      {user.topCategory || "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        className="text-blue-400 hover:text-blue-300 text-xs underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedEmail(expandedEmail === user.email ? null : user.email);
                        }}
                      >
                        {expandedEmail === user.email ? "סגור ▲" : "פרטים ▼"}
                      </button>
                    </td>
                  </tr>

                  {expandedEmail === user.email && (
                    <tr key={`${user.email}-expanded`} className="bg-slate-800/30 border-b border-slate-800">
                      <td colSpan={6} className="px-6 py-4">
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-slate-400 mb-2">פירוט קטגוריות:</p>
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(user.categoryBreakdown || {}).map(([cat, count]) => (
                              <span
                                key={cat}
                                className="bg-slate-700 text-slate-200 text-xs px-2 py-1 rounded-full"
                              >
                                {cat}: <strong>{count}</strong>
                              </span>
                            ))}
                          </div>
                          <p className="text-xs text-slate-500 mt-1">
                            נרשם לראשונה: {user.firstSeen ? new Date(user.firstSeen).toLocaleString("he-IL") : "—"}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
