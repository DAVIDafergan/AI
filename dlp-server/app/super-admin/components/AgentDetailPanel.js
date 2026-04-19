"use client";

import { useState } from "react";
import { X, Cpu, RefreshCw, Pause, Settings, Activity, Loader2, Trash2, Brain, Users, Building2, ShieldAlert, BarChart2 } from "lucide-react";

function BrainSummaryPanel({ agent }) {
  const b = agent.brainSummary || {};
  const hasBrain = (b.personsFound || 0) + (b.orgsFound || 0) + (b.piiFound || 0) > 0 || (b.lastScan);

  if (!hasBrain) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
        <Brain size={32} className="text-slate-700" />
        <p className="text-sm text-slate-500 font-medium">הסוכן טרם סרק מסמכים</p>
        <p className="text-xs text-slate-600 max-w-[220px] leading-relaxed">
          הסוכן ילמד את תוכן הכונן הארגוני בפעם הראשונה שיופעל עם הפרמטר <code className="text-cyan-500/70">--dir</code>.
        </p>
      </div>
    );
  }

  const rows = [
    { icon: Users,      label: "אנשים שזוהו",        value: b.personsFound   ?? 0, color: "text-blue-400"   },
    { icon: Building2,  label: "ארגונים / לקוחות",   value: b.orgsFound      ?? 0, color: "text-purple-400" },
    { icon: ShieldAlert,label: "רשומות PII",          value: b.piiFound       ?? 0, color: "text-red-400"    },
    { icon: BarChart2,  label: "ציון רגישות ממוצע",  value: `${b.avgSensitivity ?? 0}%`, color: "text-yellow-400" },
    { icon: Activity,   label: "קבצים רגישים מאוד",  value: b.highlySensitiveFiles ?? 0, color: "text-rose-400"   },
    { icon: Activity,   label: "קבצים רגישים",       value: b.sensitiveFiles  ?? 0, color: "text-orange-400" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Brain size={14} className="text-cyan-400" />
        <span className="text-xs text-slate-300 font-semibold">ממצאי למידת ה-AI</span>
        {b.lastScan && (
          <span className="text-[10px] text-slate-600 mr-auto">
            סריקה אחרונה: {new Date(b.lastScan).toLocaleString("he-IL")}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {rows.map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="flex items-center justify-between py-1.5 border-b border-slate-800/60 text-sm">
            <div className="flex items-center gap-2">
              <Icon size={13} className={`${color} opacity-70`} />
              <span className="text-slate-400">{label}</span>
            </div>
            <span className={`font-mono font-semibold ${color}`}>{value}</span>
          </div>
        ))}
      </div>

      {(b.topOrgs?.length > 0 || b.topPersons?.length > 0) && (
        <div className="space-y-3 pt-1">
          {b.topOrgs?.length > 0 && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">ארגונים / לקוחות שזוהו</p>
              <div className="flex flex-wrap gap-1.5">
                {b.topOrgs.slice(0, 10).map((org) => (
                  <span key={org} className="bg-purple-500/10 border border-purple-500/30 text-purple-300 text-[10px] px-2 py-0.5 rounded-full">{org}</span>
                ))}
              </div>
            </div>
          )}
          {b.topPersons?.length > 0 && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">אנשים שזוהו</p>
              <div className="flex flex-wrap gap-1.5">
                {b.topPersons.slice(0, 10).map((person) => (
                  <span key={person} className="bg-blue-500/10 border border-blue-500/30 text-blue-300 text-[10px] px-2 py-0.5 rounded-full">{person}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentDetailPanel({ agent, superAdminKey, onClose, onUpdated, onDeleted }) {
  const [tab, setTab]         = useState("brain");
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

  const STATUS_LABEL = {
    active:   "פעיל",
    learning: "לומד",
    offline:  "מנותק",
    error:    "שגיאה",
    paused:   "מושהה",
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-96 bg-[#0d0d14] border-l border-cyan-900/30 shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/40">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-purple-400" />
          <span className="text-sm font-semibold text-slate-200">{agent.name}</span>
          <span className={`text-xs ${STATUS_COLOR[agent.syncStatus] || "text-slate-400"}`}>
            [{STATUS_LABEL[agent.syncStatus] || agent.syncStatus}]
          </span>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800">
        {[["brain","🧠 מה למד"],["metrics","מדדים"],["config","הגדרות"],["actions","פעולות"]].map(([id, label]) => (
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
        {tab === "brain" && <BrainSummaryPanel agent={agent} />}

        {tab === "metrics" && (
          <div className="space-y-3">
            <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">מדדי ביצועים</h3>
            {[
              ["מסמכים מאינדקסים", agent.metrics?.documentsIndexed ?? 0],
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
            <button
              onClick={async () => {
                if (!confirm(`האם למחוק את הסוכן "${agent.name}"?`)) return;
                setLoading(true);
                try {
                  const res = await fetch(`/api/agents/${agent._id}`, {
                    method: "DELETE",
                    headers: { "x-super-admin-key": superAdminKey },
                  });
                  if (!res.ok) throw new Error((await res.json()).error);
                  onDeleted?.();
                  onClose?.();
                } catch (e) {
                  setMsg(`✗ ${e.message}`);
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
              className="w-full flex items-center gap-2 py-2.5 px-4 bg-red-500/10 border border-red-700/40 rounded-lg text-sm text-red-300 hover:bg-red-500/20 transition-colors"
            >
              <Trash2 size={14} /> מחיקת סוכן
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

