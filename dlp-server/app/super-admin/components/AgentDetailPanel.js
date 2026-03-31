"use client";

import { useState } from "react";
import { X, Cpu, RefreshCw, Pause, Settings, Activity, Loader2 } from "lucide-react";

export default function AgentDetailPanel({ agent, superAdminKey, onClose, onUpdated }) {
  const [tab, setTab]         = useState("metrics");
  const [editForm, setEditForm] = useState(null);
  const [loading, setLoading]  = useState(false);
  const [msg, setMsg]          = useState("");

  if (!agent) return null;

  const setF = (k, v) => setEditForm((f) => ({ ...f, [k]: v }));

  const handleAction = async (action) => {
    setLoading(true);
    setMsg("");
    try {
      let body = {};
      if (action === "pause")   body = { syncStatus: "paused" };
      if (action === "restart") body = { syncStatus: "learning", lastPing: null };
      if (action === "save" && editForm) body = { config: editForm };

      const res = await fetch(`/api/agents/${agent._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-super-admin-key": superAdminKey },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg("✓ עודכן בהצלחה");
      onUpdated?.(data.agent);
    } catch (e) {
      setMsg(`✗ ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const STATUS_COLOR = {
    active:   "text-green-400",
    learning: "text-blue-400",
    offline:  "text-red-400",
    error:    "text-red-400",
    paused:   "text-yellow-400",
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-96 bg-[#0d0d14] border-l border-cyan-900/30 shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/40">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-purple-400" />
          <span className="text-sm font-semibold text-slate-200">{agent.name}</span>
          <span className={`text-xs ${STATUS_COLOR[agent.syncStatus] || "text-slate-400"}`}>
            [{agent.syncStatus}]
          </span>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800">
        {[["metrics","מדדים"], ["config","הגדרות"], ["actions","פעולות"]].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-2.5 text-xs transition-colors ${tab === id ? "text-cyan-300 border-b-2 border-cyan-500" : "text-slate-500 hover:text-slate-300"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === "metrics" && (
          <div className="space-y-3">
            <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">מדדי ביצועים</h3>
            {[
              ["מסמכים מאונדקסים", agent.metrics?.documentsIndexed ?? 0],
              ["וקטורים שמורים",    agent.metrics?.vectorsStored ?? 0],
              ["סריקות שבוצעו",    agent.metrics?.scansPerformed ?? 0],
              ["חסימות שבוצעו",    agent.metrics?.blocksExecuted ?? 0],
              ["זמן תגובה ממוצע",  `${agent.metrics?.avgResponseTime ?? 0}ms`],
              ["uptime",           `${agent.metrics?.uptime ?? 0}s`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between items-center py-1.5 border-b border-slate-800/60 text-sm">
                <span className="text-slate-400">{k}</span>
                <span className="font-mono text-slate-200">{v}</span>
              </div>
            ))}
            <div className="pt-3 space-y-1 text-xs text-slate-500">
              <div>Agent Key: <code className="font-mono text-cyan-400/70">{agent.agentKey}</code></div>
              <div>גרסה: <span className="text-slate-300">{agent.version || "1.0.0"}</span></div>
              <div>סביבה: <span className="text-slate-300">{agent.environment}</span></div>
              {agent.lastPingIp && <div>IP: <span className="text-slate-300">{agent.lastPingIp}</span></div>}
            </div>
          </div>
        )}

        {tab === "config" && (
          <div className="space-y-3">
            <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">הגדרות סוכן</h3>
            {(() => {
              const cfg = editForm || agent.config || {};
              return (
                <>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">מרווח סריקה (ms)</label>
                    <input
                      type="number"
                      value={cfg.scanInterval ?? 500}
                      onChange={(e) => { if (!editForm) setEditForm({ ...agent.config }); setF("scanInterval", +e.target.value); }}
                      className="w-full bg-slate-900/60 border border-slate-700/60 rounded px-3 py-2 text-sm text-slate-200 outline-none"
                    />
                  </div>
                  {[
                    ["enableClipboard",        "ניטור לוח עריכה"],
                    ["enableFileWatch",         "ניטור קבצים"],
                    ["enableNetworkInspection", "ניטור רשת"],
                  ].map(([k, label]) => (
                    <label key={k} className="flex items-center justify-between text-sm text-slate-300 cursor-pointer">
                      {label}
                      <input
                        type="checkbox"
                        checked={!!cfg[k]}
                        onChange={(e) => { if (!editForm) setEditForm({ ...agent.config }); setF(k, e.target.checked); }}
                        className="accent-cyan-500"
                      />
                    </label>
                  ))}
                </>
              );
            })()}
            {editForm && (
              <button
                onClick={() => handleAction("save")}
                disabled={loading}
                className="w-full mt-2 flex items-center justify-center gap-2 py-2 bg-cyan-500/20 border border-cyan-600/40 rounded-lg text-sm text-cyan-300 hover:bg-cyan-500/30 transition-colors"
              >
                {loading && <Loader2 size={13} className="animate-spin" />}
                <Settings size={13} /> שמור הגדרות
              </button>
            )}
          </div>
        )}

        {tab === "actions" && (
          <div className="space-y-3">
            <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">פעולות</h3>
            <button
              onClick={() => handleAction("restart")}
              disabled={loading}
              className="w-full flex items-center gap-2 py-2.5 px-4 bg-blue-500/10 border border-blue-700/40 rounded-lg text-sm text-blue-300 hover:bg-blue-500/20 transition-colors"
            >
              <RefreshCw size={14} /> הפעלה מחדש
            </button>
            <button
              onClick={() => handleAction("pause")}
              disabled={loading}
              className="w-full flex items-center gap-2 py-2.5 px-4 bg-yellow-500/10 border border-yellow-700/40 rounded-lg text-sm text-yellow-300 hover:bg-yellow-500/20 transition-colors"
            >
              <Pause size={14} /> השהיה
            </button>
          </div>
        )}

        {msg && (
          <p className={`mt-3 text-xs ${msg.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>{msg}</p>
        )}
      </div>
    </div>
  );
}
