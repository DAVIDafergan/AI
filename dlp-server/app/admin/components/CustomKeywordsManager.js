"use client";

// ניהול מילות מפתח מותאמות לארגון
import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Tag, AlertCircle } from "lucide-react";

const SEVERITY_COLORS = {
  critical: "bg-rose-500/20 text-rose-400",
  high:     "bg-orange-500/20 text-orange-400",
  medium:   "bg-yellow-500/20 text-yellow-400",
  low:      "bg-blue-500/20 text-blue-400",
};

const EMPTY_FORM = { word: "", category: "CUSTOM", replacement: "", severity: "medium" };

export default function CustomKeywordsManager({ apiKey }) {
  const [keywords, setKeywords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fetchKeywords = useCallback(async () => {
    const headers = apiKey
      ? { "Content-Type": "application/json", "x-api-key": apiKey }
      : { "Content-Type": "application/json" };
    try {
      const res = await fetch("/api/custom-keywords", { headers });
      if (!res.ok) return;
      const data = await res.json();
      setKeywords(data.keywords || []);
    } catch {
      // שגיאת רשת
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => { fetchKeywords(); }, [fetchKeywords]);

  async function handleAdd() {
    if (!form.word.trim()) { setError("יש להזין מילה"); return; }
    setSaving(true);
    setError("");
    const headers = apiKey
      ? { "Content-Type": "application/json", "x-api-key": apiKey }
      : { "Content-Type": "application/json" };
    try {
      const res = await fetch("/api/custom-keywords", {
        method: "POST",
        headers,
        body: JSON.stringify(form),
      });
      if (!res.ok) { setError("שגיאה בשמירה"); return; }
      setForm(EMPTY_FORM);
      setShowForm(false);
      await fetchKeywords();
    } catch {
      setError("שגיאת רשת");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    const headers = apiKey ? { "x-api-key": apiKey } : {};
    try {
      await fetch(`/api/custom-keywords?id=${id}`, { method: "DELETE", headers });
      setKeywords((prev) => prev.filter((k) => k.id !== id));
    } catch {
      // שגיאת רשת
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-700/50 rounded-xl shadow-lg">
      {/* כותרת */}
      <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <Tag className="w-5 h-5 text-amber-400" />
          <h3 className="text-white font-semibold text-lg">מילות מפתח מותאמות</h3>
          <span className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded-full">
            {keywords.length}
          </span>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setError(""); }}
          className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-lg text-sm hover:bg-amber-500/20 transition-colors"
        >
          <Plus className="w-4 h-4" />
          הוסף מילה
        </button>
      </div>

      {/* טופס הוספה */}
      {showForm && (
        <div className="p-4 border-b border-slate-700/50 bg-slate-800/50">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">מילה / ביטוי *</label>
              <input
                type="text"
                value={form.word}
                onChange={(e) => setForm((f) => ({ ...f, word: e.target.value }))}
                placeholder="למשל: מסמך סודי"
                className="w-full bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-500"
                dir="rtl"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">קטגוריה</label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="CUSTOM"
                className="w-full bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">החלפה (אופציונלי)</label>
              <input
                type="text"
                value={form.replacement}
                onChange={(e) => setForm((f) => ({ ...f, replacement: e.target.value }))}
                placeholder="מה יוצג במקום"
                className="w-full bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-500"
                dir="rtl"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">חומרה</label>
              <select
                value={form.severity}
                onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                <option value="low">נמוכה</option>
                <option value="medium">בינונית</option>
                <option value="high">גבוהה</option>
                <option value="critical">קריטית</option>
              </select>
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 mt-2 text-rose-400 text-xs">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleAdd}
              disabled={saving}
              className="px-4 py-1.5 bg-amber-500 text-slate-900 text-sm font-semibold rounded-lg hover:bg-amber-400 transition-colors disabled:opacity-60"
            >
              {saving ? "שומר..." : "שמור"}
            </button>
            <button
              onClick={() => { setShowForm(false); setError(""); setForm(EMPTY_FORM); }}
              className="px-4 py-1.5 bg-slate-700 text-white text-sm rounded-lg hover:bg-slate-600 transition-colors"
            >
              ביטול
            </button>
          </div>
        </div>
      )}

      {/* טבלת מילות מפתח */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="text-center text-slate-400 py-8">טוען...</div>
        ) : keywords.length === 0 ? (
          <div className="text-center text-slate-400 py-12">
            <Tag className="w-10 h-10 mx-auto mb-3 text-slate-600" />
            <p>לא הוגדרו מילות מפתח מותאמות</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">מילה</th>
                <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">קטגוריה</th>
                <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">החלפה</th>
                <th className="text-right text-slate-400 text-xs font-medium px-4 py-3">חומרה</th>
                <th className="text-right text-slate-400 text-xs font-medium px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {keywords.map((kw) => (
                <tr key={kw.id} className="border-b border-slate-700/30 hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 text-white text-sm font-medium">{kw.word}</td>
                  <td className="px-4 py-3">
                    <code className="text-xs bg-slate-800 text-amber-400 px-2 py-1 rounded font-mono">
                      {kw.category}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-sm">
                    {kw.replacement || <span className="text-slate-600">אוטומטי</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${SEVERITY_COLORS[kw.severity] || SEVERITY_COLORS.medium}`}>
                      {kw.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(kw.id)}
                      className="text-slate-500 hover:text-rose-400 transition-colors"
                      title="מחק"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
