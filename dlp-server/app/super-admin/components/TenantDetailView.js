"use client";

import { useEffect, useState } from "react";
import { Building2, ArrowLeft, Cpu, Activity } from "lucide-react";

const STATUS_COLORS = {
  active:   "bg-green-500/20 text-green-400 border-green-700/40",
  trial:    "bg-blue-500/20 text-blue-400 border-blue-700/40",
  suspended:"bg-red-500/20 text-red-400 border-red-700/40",
  expired:  "bg-slate-500/20 text-slate-400 border-slate-700/40",
};

export default function TenantDetailView({ tenant, superAdminKey, onBack }) {
  const [agents, setAgents]   = useState([]);
  const [events, setEvents]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [agentsRes, eventsRes] = await Promise.all([
          fetch(`/api/agents?tenantId=${tenant._id}`, {
            headers: { "x-super-admin-key": superAdminKey },
          }),
          fetch(`/api/tenant-events?tenantId=${tenant._id}&limit=20`, {
            headers: { "x-super-admin-key": superAdminKey },
          }),
        ]);
        if (agentsRes.ok) setAgents((await agentsRes.json()).agents || []);
        if (eventsRes.ok) setEvents((await eventsRes.json()).events || []);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [tenant, superAdminKey]);

  if (!tenant) return null;

  return (
    <div className="space-y-4">
      {/* Back button + header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors">
          <ArrowLeft size={14} /> חזרה
        </button>
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-cyan-400" />
          <h2 className="text-base font-semibold text-slate-200">{tenant.name}</h2>
          <span className={`inline-block px-2 py-0.5 rounded border text-xs ${STATUS_COLORS[tenant.status] || STATUS_COLORS.trial}`}>
            {tenant.status}
          </span>
        </div>
      </div>

      {/* Usage stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ["סריקות כולל",  tenant.usage?.totalScans  ?? 0, "text-cyan-400"],
          ["חסימות כולל",  tenant.usage?.totalBlocks ?? 0, "text-red-400"],
          ["מכסה חודשית",  tenant.usage?.monthlyQuota ?? 0, "text-slate-300"],
          ["סוכנים",        agents.length, "text-purple-400"],
        ].map(([label, value, color]) => (
          <div key={label} className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
            <div className="text-xs text-slate-500 mb-1">{label}</div>
            <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Agents list */}
      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Cpu size={14} className="text-purple-400" />
          <span className="text-sm text-slate-300 font-medium">סוכנים</span>
        </div>
        {loading ? (
          <p className="text-xs text-slate-600">טוען...</p>
        ) : agents.length === 0 ? (
          <p className="text-xs text-slate-600">אין סוכנים פרוסים עבור דייר זה</p>
        ) : (
          <div className="space-y-2">
            {agents.map((a) => (
              <div key={a._id} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-800/60">
                <span className="text-slate-200">{a.name}</span>
                <span className={`text-xs ${a.syncStatus === "active" ? "text-green-400" : "text-slate-400"}`}>
                  {a.syncStatus}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent events */}
      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={14} className="text-red-400" />
          <span className="text-sm text-slate-300 font-medium">אירועים אחרונים</span>
        </div>
        {loading ? (
          <p className="text-xs text-slate-600">טוען...</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-slate-600">אין אירועים</p>
        ) : (
          <div className="space-y-1">
            {events.map((e) => (
              <div key={e._id} className="flex items-center justify-between text-xs py-1 border-b border-slate-800/40">
                <span className="text-slate-400">{e.eventType}</span>
                <span className={`text-xs ${e.severity === "critical" ? "text-red-400" : e.severity === "high" ? "text-orange-400" : "text-slate-500"}`}>
                  {e.severity}
                </span>
                <span className="text-slate-600">
                  {e.timestamp ? new Date(e.timestamp).toLocaleString("he-IL") : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tenant info */}
      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4 text-xs space-y-2 text-slate-400">
        <div>תוכנית: <span className="text-slate-200">{tenant.plan}</span></div>
        <div>קשר: <span className="text-slate-200">{tenant.contactEmail}</span></div>
        {tenant.domain && <div>דומיין: <span className="text-slate-200">{tenant.domain}</span></div>}
        <div>נוצר: <span className="text-slate-200">{tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString("he-IL") : "—"}</span></div>
      </div>
    </div>
  );
}
