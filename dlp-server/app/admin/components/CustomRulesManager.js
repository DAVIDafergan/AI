"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Tag } from "lucide-react";

export default function CustomRulesManager() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ word: "", category: "CUSTOM", replacement: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch("/api/custom-rules");
      if (!res.ok) throw new Error("שגיאה בטעינת הכללים");
      const data = await res.json();
      setRules(data.rules || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!form.word.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/custom-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("שגיאה בהוספת הכלל");
      const data = await res.json();
      setRules(prev => [...prev, data.rule]);
      setForm({ word: "", category: "CUSTOM", replacement: "" });
      setShowForm(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    try {
      const res = await fetch(`/api/custom-rules?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("שגיאה במחיקת הכלל");
      setRules(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-6 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Tag className="w-5 h-5 text-amber-400" />
          <h3 className="text-white font-semibold text-lg">כללים מותאמים אישית</h3>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          הוסף כלל
        </button>
      </div>

      {error && (
        <p className="text-rose-400 text-sm mb-3">{error}</p>
      )}

      {showForm && (
        <form onSubmit={handleAdd} className="bg-slate-800/60 border border-slate-700/40 rounded-xl p-4 mb-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-slate-400 text-xs mb-1 block">מילה / ביטוי רגיש</label>
              <input
                type="text"
                value={form.word}
                onChange={e => setForm(f => ({ ...f, word: e.target.value }))}
                placeholder="לדוגמה: סיסמת מנהל"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                required
              />
            </div>
            <div>
              <label className="text-slate-400 text-xs mb-1 block">קטגוריה</label>
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              >
                <option value="CUSTOM">כללי</option>
                <option value="PROJECT">פרויקט</option>
                <option value="FINANCE">פיננסי</option>
                <option value="STRATEGY">אסטרטגי</option>
                <option value="INTERNAL">פנימי</option>
              </select>
            </div>
            <div>
              <label className="text-slate-400 text-xs mb-1 block">החלפה (אופציונלי)</label>
              <input
                type="text"
                value={form.replacement}
                onChange={e => setForm(f => ({ ...f, replacement: e.target.value }))}
                placeholder="לדוגמה: מידע פנימי"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
            >
              ביטול
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {submitting ? "שומר..." : "שמור כלל"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-slate-500 text-sm text-center py-4">טוען כללים...</div>
      ) : rules.length === 0 ? (
        <div className="text-slate-500 text-sm text-center py-6">
          אין כללים מותאמים. לחץ על &quot;הוסף כלל&quot; להתחלה.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-right text-slate-400 text-xs font-medium px-3 py-2">ביטוי רגיש</th>
                <th className="text-right text-slate-400 text-xs font-medium px-3 py-2">קטגוריה</th>
                <th className="text-right text-slate-400 text-xs font-medium px-3 py-2">החלפה</th>
                <th className="text-right text-slate-400 text-xs font-medium px-3 py-2">נוצר</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.id} className="border-b border-slate-700/30 hover:bg-slate-800/40 transition-colors">
                  <td className="px-3 py-3 text-white text-sm font-medium">{rule.word}</td>
                  <td className="px-3 py-3">
                    <span className="text-xs bg-slate-800 text-amber-400 px-2 py-0.5 rounded">
                      {rule.category}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-400 text-sm">{rule.replacement || "—"}</td>
                  <td className="px-3 py-3 text-slate-500 text-xs whitespace-nowrap">
                    {new Date(rule.createdAt).toLocaleDateString("he-IL")}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                      title="מחק כלל"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
