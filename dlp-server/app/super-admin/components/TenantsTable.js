"use client";

import { useState, useMemo } from "react";
import { Search, ChevronUp, ChevronDown, Trash2, Edit2, PauseCircle, Eye } from "lucide-react";

const STATUS_COLORS = {
  active:    "bg-green-500/20 text-green-400 border-green-700/40",
  trial:     "bg-blue-500/20 text-blue-400 border-blue-700/40",
  suspended: "bg-red-500/20 text-red-400 border-red-700/40",
  expired:   "bg-slate-500/20 text-slate-400 border-slate-700/40",
};

const PLAN_COLORS = {
  starter:      "text-slate-300",
  professional: "text-cyan-300",
  enterprise:   "text-purple-300",
};

function SortIcon({ field, sort }) {
  if (sort.field !== field) return <ChevronUp size={12} className="opacity-20" />;
  return sort.dir === "asc" ? <ChevronUp size={12} className="text-cyan-400" /> : <ChevronDown size={12} className="text-cyan-400" />;
}

export default function TenantsTable({ tenants = [], onView, onEdit, onSuspend, onDelete }) {
  const [query, setQuery]   = useState("");
  const [sort, setSort]     = useState({ field: "createdAt", dir: "desc" });

  const toggleSort = (field) =>
    setSort((s) => ({ field, dir: s.field === field && s.dir === "asc" ? "desc" : "asc" }));

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const list = tenants.filter(
      (t) =>
        !q ||
        t.name?.toLowerCase().includes(q) ||
        t.contactEmail?.toLowerCase().includes(q) ||
        t.slug?.toLowerCase().includes(q)
    );
    return [...list].sort((a, b) => {
      let av = a[sort.field], bv = b[sort.field];
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [tenants, query, sort]);

  const cols = [
    { key: "name",     label: "שם" },
    { key: "status",   label: "סטטוס" },
    { key: "plan",     label: "תוכנית" },
    { key: "agents",   label: "סוכנים", sortable: false },
    { key: "usage.totalScans",  label: "סריקות" },
    { key: "usage.totalBlocks", label: "חסימות" },
    { key: "usage.lastActivity", label: "פעיל לאחרונה" },
  ];

  return (
    <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl overflow-hidden">
      {/* Search bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/40">
        <Search size={15} className="text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש דיירים..."
          className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 outline-none"
        />
        <span className="text-xs text-slate-600">{filtered.length} דיירים</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              {cols.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable !== false && toggleSort(col.key)}
                  className={`px-4 py-3 text-right text-xs text-slate-500 uppercase tracking-wider whitespace-nowrap ${
                    col.sortable !== false ? "cursor-pointer hover:text-slate-300" : ""
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable !== false && <SortIcon field={col.key} sort={sort} />}
                  </span>
                </th>
              ))}
              <th className="px-4 py-3 text-right text-xs text-slate-500 uppercase tracking-wider">פעולות</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={cols.length + 1} className="px-4 py-8 text-center text-slate-600">
                  אין דיירים להצגה
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={t._id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 text-slate-200 font-medium">{t.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${STATUS_COLORS[t.status] || STATUS_COLORS.trial}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className={`px-4 py-3 font-medium ${PLAN_COLORS[t.plan] || ""}`}>{t.plan}</td>
                  <td className="px-4 py-3 text-slate-400">{t.agentCount ?? 0}</td>
                  <td className="px-4 py-3 text-slate-400 font-mono">{t.usage?.totalScans ?? 0}</td>
                  <td className="px-4 py-3 text-slate-400 font-mono">{t.usage?.totalBlocks ?? 0}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {t.usage?.lastActivity
                      ? new Date(t.usage.lastActivity).toLocaleString("he-IL")
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => onView?.(t)} title="צפייה" className="p-1.5 rounded hover:bg-cyan-900/30 text-slate-400 hover:text-cyan-400 transition-colors"><Eye size={14} /></button>
                      <button onClick={() => onEdit?.(t)} title="עריכה" className="p-1.5 rounded hover:bg-blue-900/30 text-slate-400 hover:text-blue-400 transition-colors"><Edit2 size={14} /></button>
                      <button onClick={() => onSuspend?.(t)} title="השעיה" className="p-1.5 rounded hover:bg-yellow-900/30 text-slate-400 hover:text-yellow-400 transition-colors"><PauseCircle size={14} /></button>
                      <button onClick={() => onDelete?.(t)} title="מחיקה" className="p-1.5 rounded hover:bg-red-900/30 text-slate-400 hover:text-red-400 transition-colors"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
