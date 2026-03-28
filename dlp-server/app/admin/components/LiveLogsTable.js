"use client";

// טבלת לוגים חיים
// צבעי נקודה לפי סוג מידע
const TYPE_COLORS = {
  "כרטיס אשראי": "#f43f5e",
  "תעודת זהות": "#8b5cf6",
  "אימייל": "#3b82f6",
  "טלפון נייד": "#22c55e",
  "פרויקט סודי": "#f59e0b",
  "דוח כספי": "#f59e0b",
  "מילות מפתח": "#f59e0b",
};

// פורמט זמן בעברית
function formatTime(timestamp) {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return timestamp;
  }
}

export default function LiveLogsTable({ logs }) {
  if (!logs || logs.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-6 text-center text-slate-400">
        אין לוגים להצגה
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden shadow-lg">
      <div className="p-6 border-b border-slate-700/50">
        <h3 className="text-white font-semibold text-lg">לוגים אחרונים</h3>
      </div>
      {/* גלילה אופקית במסכים קטנים */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">#</th>
              <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">זמן</th>
              <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">סוג מידע</th>
              <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">Placeholder</th>
              <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">מקור</th>
              <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr
                key={log.id}
                className="border-b border-slate-700/30 hover:bg-slate-800/50 transition-colors"
              >
                {/* מספר שורה */}
                <td className="px-4 py-3 text-slate-500 text-sm">{log.id}</td>
                {/* זמן */}
                <td className="px-4 py-3 text-slate-400 text-sm whitespace-nowrap">
                  {formatTime(log.timestamp)}
                </td>
                {/* סוג מידע עם נקודה צבעונית */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: TYPE_COLORS[log.type] || "#94a3b8" }}
                    />
                    <span className="text-white text-sm whitespace-nowrap">{log.type}</span>
                  </div>
                </td>
                {/* Placeholder במונוספייס */}
                <td className="px-4 py-3">
                  <code className="text-xs bg-slate-800 text-amber-400 px-2 py-1 rounded font-mono">
                    {log.placeholder}
                  </code>
                </td>
                {/* מקור */}
                <td className="px-4 py-3 text-slate-400 text-sm whitespace-nowrap">
                  {log.source}
                </td>
                {/* סטטוס עם תג צבעוני */}
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
    </div>
  );
}
