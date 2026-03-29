"use client";

// כפתור ייצוא דוח JSON/CSV מלא
import { useState } from "react";
import { FileDown } from "lucide-react";

export default function ExportPdfButton() {
  const [loading, setLoading] = useState(false);

  async function handleExport(format = "json") {
    setLoading(true);
    try {
      const res = await fetch(`/api/export-report?format=${format}`);
      if (!res.ok) throw new Error("שגיאה בייצוא");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const ext = format === "csv" ? "csv" : "json";
      const date = new Date().toISOString().slice(0, 10);

      const link = document.createElement("a");
      link.href = url;
      link.download = `dlp-report-${date}.${ext}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[ExportPdfButton]", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={() => handleExport("json")}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-white text-sm transition-all duration-200 bg-gradient-to-l from-violet-500 to-indigo-500 hover:opacity-90 active:scale-95 disabled:opacity-60 shadow-lg shadow-violet-500/20"
      >
        <FileDown className="w-4 h-4" />
        {loading ? "מייצא..." : "Export JSON"}
      </button>
      <button
        onClick={() => handleExport("csv")}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-white text-sm transition-all duration-200 bg-gradient-to-l from-blue-500 to-cyan-500 hover:opacity-90 active:scale-95 disabled:opacity-60 shadow-lg shadow-blue-500/20"
      >
        <FileDown className="w-4 h-4" />
        {loading ? "מייצא..." : "Export CSV"}
      </button>
    </div>
  );
}
