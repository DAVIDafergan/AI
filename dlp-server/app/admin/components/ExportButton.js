"use client";

// כפתור ייצוא CSV עם תמיכה בעברית באקסל (BOM)
import { useState } from "react";
import { Download } from "lucide-react";

export default function ExportButton({ logs }) {
  const [loading, setLoading] = useState(false);

  function handleExport() {
    if (!logs || logs.length === 0) return;
    setLoading(true);

    // כותרות בעברית
    const headers = ["זמן", "סוג מידע", "Placeholder", "מקור", "סטטוס"];
    const statusHebrew = { blocked: "נחסם", allowed: "מותר" };

    const rows = logs.map((log) => [
      log.timestamp,
      log.type,
      log.placeholder,
      log.source,
      statusHebrew[log.status] || log.status,
    ]);

    // בניית תוכן ה-CSV
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    // הוספת BOM לתמיכה בעברית באקסל
    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    // הורדה אוטומטית
    const date = new Date().toISOString().slice(0, 10);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dlp-report-${date}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    setTimeout(() => setLoading(false), 1000);
  }

  return (
    <button
      onClick={handleExport}
      disabled={loading}
      className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-white text-sm transition-all duration-200 bg-gradient-to-l from-emerald-500 to-blue-500 hover:opacity-90 active:scale-95 disabled:opacity-60 shadow-lg shadow-emerald-500/20"
    >
      <Download className="w-4 h-4" />
      {loading ? "מייצא..." : "Export CSV"}
    </button>
  );
}
