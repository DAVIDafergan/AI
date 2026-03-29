"use client";

// טבלת לוגים חיים עם חיפוש, פילטור, עימוד ואפשרות גילוי ערך מקורי
import { useState } from "react";
import { Eye, EyeOff, ChevronRight, ChevronLeft } from "lucide-react";

const TYPE_COLORS = {
  "כרטיס אשראי":  "#f43f5e",
  "תעודת זהות":   "#8b5cf6",
  "אימייל":        "#3b82f6",
  "טלפון נייד":   "#22c55e",
  "טלפון נייח":   "#06b6d4",
  "IBAN":          "#f97316",
  "כתובת IP":     "#a855f7",
  "דרכון":        "#ec4899",
  "מלוחית":       "#14b8a6",
  "תאריך לידה":   "#84cc16",
  "מפתח AWS":     "#ef4444",
  "מפתח OpenAI":  "#10b981",
  "מפתח API":     "#6366f1",
  "כתובת":        "#0ea5e9",
  "שם מלא":       "#d946ef",
  "סיסמה":        "#dc2626",
  "חשבון בנק":    "#b45309",
  "מילות מפתח":   "#f59e0b",
};

const PAGE_SIZE = 10;

function formatTime(timestamp) {
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return timestamp;
  }
}

// שורה בטבלה עם כפתור גילוי
function LogRow({ log, rowNum }) {
  const [revealed, setRevealed] = useState(false);
  const [originalText, setOriginalText] = useState(null);
  const [loadingReveal, setLoadingReveal] = useState(false);

  async function handleReveal() {
    if (revealed) { setRevealed(false); return; }
    const syntheticVal = log.placeholder || log.synthetic;
    if (!syntheticVal) return;

    setLoadingReveal(true);
    try {
      const res = await fetch(`/api/check-text?synthetic=${encodeURIComponent(syntheticVal)}`);
      if (res.ok) {
        const data = await res.json();
        setOriginalText(data.original || "—");
      } else {
        setOriginalText("(לא נמצא)");
      }
    } catch {
      setOriginalText("(שגיאת רשת)");
    } finally {
      setLoadingReveal(false);
      setRevealed(true);
    }
  }

  return (
    <tr className="border-b border-slate-700/30 hover:bg-slate-800/50 transition-colors">
      <td className="px-4 py-3 text-slate-500 text-sm">{rowNum}</td>
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
        <div className="flex items-center gap-2">
          <code className="text-xs bg-slate-800 text-amber-400 px-2 py-1 rounded font-mono">
            {log.placeholder || log.synthetic || "—"}
          </code>
          {/* כפתור גילוי ערך מקורי */}
          <button
            onClick={handleReveal}
            title={revealed ? "הסתר" : "הצג ערך מקורי"}
            className="text-slate-500 hover:text-rose-400 transition-colors flex-shrink-0"
            disabled={loadingReveal}
          >
            {loadingReveal ? (
              <span className="text-xs text-slate-500">...</span>
            ) : revealed ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>
        {/* ערך מקורי שנחשף */}
        {revealed && originalText && (
          <div className="mt-1 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-2 py-1 font-mono">
            🔓 {originalText}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-slate-400 text-sm whitespace-nowrap">
        {log.source}
      </td>
      {log.threatScore !== undefined && (
        <td className="px-4 py-3">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            log.threatScore >= 80 ? "bg-rose-500/20 text-rose-400" :
            log.threatScore >= 50 ? "bg-orange-500/20 text-orange-400" :
            log.threatScore >= 20 ? "bg-yellow-500/20 text-yellow-400" :
            "bg-emerald-500/20 text-emerald-400"
          }`}>
            {log.threatScore}
          </span>
        </td>
      )}
      <td className="px-4 py-3">
        {log.status === "blocked" ? (
          <span className="text-xs font-medium px-2 py-1 rounded-full bg-rose-500/20 text-rose-400">
            נחסם
          </span>
        ) : (
          <span className="text-xs font-medium px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400">
            נקי
          </span>
        )}
      </td>
    </tr>
  );
}

export default function LiveLogsTable({ logs, searchQuery = "", categoryFilter = "all" }) {
  const [page, setPage] = useState(1);

  if (!logs || logs.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-6 text-center text-slate-400">
        אין לוגים להצגה
      </div>
    );
  }

  // פילטור לפי חיפוש וקטגוריה
  const filtered = logs.filter((log) => {
    const matchSearch =
      !searchQuery ||
      log.type?.includes(searchQuery) ||
      log.source?.includes(searchQuery) ||
      (log.placeholder || log.synthetic || "").includes(searchQuery);
    const matchCat =
      categoryFilter === "all" || log.type === categoryFilter;
    return matchSearch && matchCat;
  });

  // עימוד
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const hasThreatScore = logs.some((l) => l.threatScore !== undefined);

  return (
    <div className="bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden shadow-lg">
      <div className="p-6 border-b border-slate-700/50 flex items-center justify-between">
        <h3 className="text-white font-semibold text-lg">לוגים אחרונים</h3>
        <span className="text-xs text-slate-400">
          {filtered.length} רשומות
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">#</th>
              <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">זמן</th>
              <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">סוג מידע</th>
              <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">ערך סינתטי</th>
              <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">מקור</th>
              {hasThreatScore && (
                <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">ציון איום</th>
              )}
              <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((log, i) => (
              <LogRow
                key={log.id || i}
                log={log}
                rowNum={(safePage - 1) * PAGE_SIZE + i + 1}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* עימוד */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-700/50">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="flex items-center gap-1 text-sm text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
            הקודם
          </button>
          <span className="text-sm text-slate-400">
            עמוד {safePage} מתוך {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="flex items-center gap-1 text-sm text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
          >
            הבא
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
