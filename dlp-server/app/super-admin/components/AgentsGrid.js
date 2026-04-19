"use client";

import { useEffect, useState } from "react";
import { Cpu, LayoutGrid, List, RefreshCw, Trash2, Brain, Wifi, WifiOff } from "lucide-react";

const STATUS_COLORS = {
  active:   { dot: "bg-green-400",  text: "text-green-400",  border: "border-green-700/40" },
  learning: { dot: "bg-blue-400",   text: "text-blue-400",   border: "border-blue-700/40"  },
  offline:  { dot: "bg-red-500",    text: "text-red-400",    border: "border-red-700/40"   },
  error:    { dot: "bg-red-500",    text: "text-red-400",    border: "border-red-700/40"   },
  paused:   { dot: "bg-yellow-400", text: "text-yellow-400", border: "border-yellow-700/40"},
};

const STATUS_LABELS = {
  active:   "פעיל",
  learning: "לומד",
  offline:  "מנותק",
  error:    "שגיאה",
  paused:   "מושהה",
};

function StatusDot({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.offline;
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${c.dot} ${status === "active" ? "animate-pulse" : ""}`} />
  );
}

function AgentCard({ agent, onClick, onDelete }) {
  const c = STATUS_COLORS[agent.syncStatus] || STATUS_COLORS.offline;
  const b = agent.brainSummary || {};
  const hasBrain = (b.personsFound || 0) + (b.orgsFound || 0) + (b.piiFound || 0) > 0;
  const isConnected = !!agent.commandChannelConnected;
  return (
    <div
      onClick={() => onClick?.(agent)}
      className={`cursor-pointer bg-[#0d0d14] border ${c.border} rounded-xl p-4 hover:bg-slate-800/30 transition-all hover:shadow-[0_0_20px_rgba(34,211,238,0.06)]`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Cpu size={16} className={c.text} />
          <span className="text-sm text-slate-200 font-medium">{agent.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <StatusDot status={agent.syncStatus} />
            <span className={`text-xs ${c.text}`}>{STATUS_LABELS[agent.syncStatus] || agent.syncStatus}</span>
          </div>
          {/* Command channel indicator */}
          <span
            title={isConnected ? "מחובר לערוץ פקודות" : "ערוץ פקודות לא פעיל"}
            className={`text-[9px] ${isConnected ? "text-green-400" : "text-slate-600"}`}
          >
            {isConnected ? <Wifi size={10} /> : <WifiOff size={10} />}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete?.(agent); }}
            title="מחק סוכן"
            className="p-1 rounded hover:bg-red-900/40 text-slate-600 hover:text-red-400 transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-y-1 text-xs text-slate-500 mb-3">
        <span>סריקות</span>  <span className="text-slate-300 font-mono text-right">{agent.metrics?.scansPerformed ?? 0}</span>
        <span>חסימות</span>  <span className="text-slate-300 font-mono text-right">{agent.metrics?.blocksExecuted ?? 0}</span>
        <span>מסמכים</span>  <span className="text-slate-300 font-mono text-right">{agent.metrics?.documentsIndexed ?? 0}</span>
        <span>תגובה</span>   <span className="text-slate-300 font-mono text-right">{agent.metrics?.avgResponseTime ?? 0}ms</span>
      </div>

      {hasBrain ? (
        <div className="border-t border-slate-800/60 pt-2 space-y-1 text-[10px]">
          <div className="flex items-center gap-1 text-cyan-500/70 mb-1">
            <Brain size={9} />
            <span className="uppercase tracking-wider">ידע נרכש</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {b.orgsFound > 0 && (
              <span className="bg-purple-500/10 border border-purple-500/25 text-purple-300 px-1.5 py-0.5 rounded text-center">
                {b.orgsFound} ארגונים
              </span>
            )}
            {b.personsFound > 0 && (
              <span className="bg-blue-500/10 border border-blue-500/25 text-blue-300 px-1.5 py-0.5 rounded text-center">
                {b.personsFound} אנשים
              </span>
            )}
            {b.piiFound > 0 && (
              <span className="bg-red-500/10 border border-red-500/25 text-red-300 px-1.5 py-0.5 rounded text-center">
                {b.piiFound} PII
              </span>
            )}
          </div>
        </div>
      ) : agent.syncStatus === "learning" ? (
        <div className="border-t border-slate-800/60 pt-2 text-[10px] text-blue-400/70 flex items-center gap-1">
          <Brain size={9} className="animate-pulse" />
          <span>לומד את תוכן הכונן הארגוני...</span>
        </div>
      ) : (
        <div className="border-t border-slate-800/60 pt-2 text-[10px] text-slate-600 flex items-center gap-1">
          <Brain size={9} />
          <span>טרם נסרקו מסמכים</span>
        </div>
      )}

      {agent.lastPing && (
        <div className="mt-2 text-[10px] text-slate-600">
          Ping: {new Date(agent.lastPing).toLocaleTimeString("he-IL")}
        </div>
      )}
    </div>
  );
}

function AgentRow({ agent, onClick, onDelete }) {
  const c = STATUS_COLORS[agent.syncStatus] || STATUS_COLORS.offline;
  return (
    <tr className="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
      <td onClick={() => onClick?.(agent)} className="cursor-pointer px-4 py-2.5 text-slate-200 text-sm">{agent.name}</td>
      <td onClick={() => onClick?.(agent)} className="cursor-pointer px-4 py-2.5">
        <span className={`inline-flex items-center gap-1.5 text-xs ${c.text}`}>
          <StatusDot status={agent.syncStatus} /> {STATUS_LABELS[agent.syncStatus] || agent.syncStatus}
        </span>
      </td>
      <td onClick={() => onClick?.(agent)} className="cursor-pointer px-4 py-2.5 text-slate-400 font-mono text-xs">{agent.metrics?.scansPerformed ?? 0}</td>
      <td onClick={() => onClick?.(agent)} className="cursor-pointer px-4 py-2.5 text-slate-400 font-mono text-xs">{agent.metrics?.blocksExecuted ?? 0}</td>
      <td onClick={() => onClick?.(agent)} className="cursor-pointer px-4 py-2.5 text-slate-500 text-xs">
        {agent.lastPing ? new Date(agent.lastPing).toLocaleTimeString("he-IL") : "—"}
      </td>
      <td className="px-4 py-2.5">
        <button
          onClick={() => onDelete?.(agent)}
          title="מחק סוכן"
          className="p-1.5 rounded hover:bg-red-900/30 text-slate-500 hover:text-red-400 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      </td>
    </tr>
  );
}

export default function AgentsGrid({ superAdminKey, onSelectAgent }) {
  const [agents, setAgents]   = useState([]);
  const [view, setView]       = useState("grid");
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchAgents = async () => {
    try {
      const res = await fetch("/api/agents", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setAgents(data.agents || []);
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  };

  const deleteAgent = async (agent) => {
    if (!confirm(`האם למחוק את הסוכן "${agent.name}"?`)) return;
    try {
      const res = await fetch(`/api/agents/${agent._id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error || "שגיאה במחיקה");
      setAgents((prev) => prev.filter((a) => a._id !== agent._id));
    } catch (e) {
      alert(`שגיאה במחיקת הסוכן: ${e.message}`);
    }
  };

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/40">
        <div className="flex items-center gap-2">
          <Cpu size={15} className="text-purple-400" />
          <span className="text-sm text-slate-200 font-medium">סוכנים פרוסים</span>
          <span className="text-xs text-slate-600">{agents.length} סה"כ</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600">
            {lastRefresh && `רענון: ${lastRefresh.toLocaleTimeString("he-IL")}`}
          </span>
          <button onClick={fetchAgents} className="p-1.5 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={() => setView("grid")} className={`p-1.5 rounded transition-colors ${view === "grid" ? "text-cyan-400" : "text-slate-500 hover:text-slate-300"}`}>
            <LayoutGrid size={13} />
          </button>
          <button onClick={() => setView("list")} className={`p-1.5 rounded transition-colors ${view === "list" ? "text-cyan-400" : "text-slate-500 hover:text-slate-300"}`}>
            <List size={13} />
          </button>
        </div>
      </div>

      {view === "grid" ? (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {agents.length === 0 ? (
            <p className="col-span-full text-center text-slate-600 py-8">אין סוכנים פרוסים</p>
          ) : agents.map((a) => (
            <AgentCard key={a._id} agent={a} onClick={onSelectAgent} onDelete={deleteAgent} />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {["שם", "סטטוס", "סריקות", "חסימות", "Ping אחרון", ""].map((h) => (
                  <th key={h || "actions"} className="px-4 py-3 text-right text-xs text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-600">אין סוכנים</td></tr>
              ) : agents.map((a) => (
                <AgentRow key={a._id} agent={a} onClick={onSelectAgent} onDelete={deleteAgent} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
