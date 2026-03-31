"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowRight, Shield, Building2, Cpu, Activity,
  Copy, CheckCheck, RefreshCw, AlertTriangle, Circle,
} from "lucide-react";

// ── Dummy data for offline/demo mode ──────────────────────────
const DEMO_CLIENTS = {
  "dummy-1": {
    _id: "dummy-1",
    name: "אקמה בעמ",
    status: "active",
    plan: "enterprise",
    agentCount: 12,
    apiKey: "gl-key-acme-7f3a9b2c",
    contactEmail: "admin@acme.co.il",
    slug: "acme-corp",
    usage: { totalScans: 14820, totalBlocks: 237, lastActivity: new Date(Date.now() - 3600000).toISOString() },
  },
  "dummy-2": {
    _id: "dummy-2",
    name: "טק-ווב מערכות",
    status: "trial",
    plan: "professional",
    agentCount: 4,
    apiKey: "gl-key-techweb-4d1e8f",
    contactEmail: "it@techweb.co.il",
    slug: "techweb",
    usage: { totalScans: 3210, totalBlocks: 45, lastActivity: new Date(Date.now() - 7200000).toISOString() },
  },
  "dummy-3": {
    _id: "dummy-3",
    name: "גלובל-נט תקשורת",
    status: "suspended",
    plan: "starter",
    agentCount: 0,
    apiKey: "gl-key-globalnet-9c2d5a",
    contactEmail: "ops@globalnet.co.il",
    slug: "globalnet",
    usage: { totalScans: 891, totalBlocks: 8, lastActivity: new Date(Date.now() - 86400000 * 3).toISOString() },
  },
};

const DEMO_EVENTS = [
  { _id: "e1", eventType: "block",          userEmail: "user@acme.co.il",     timestamp: new Date(Date.now() - 1200000).toISOString(),  severity: "high" },
  { _id: "e2", eventType: "scan",           userEmail: "dev@acme.co.il",      timestamp: new Date(Date.now() - 3600000).toISOString(),  severity: "low" },
  { _id: "e3", eventType: "alert",          userEmail: "manager@acme.co.il",  timestamp: new Date(Date.now() - 7200000).toISOString(),  severity: "medium" },
  { _id: "e4", eventType: "agent_connect",  userEmail: "system",              timestamp: new Date(Date.now() - 10800000).toISOString(), severity: "info" },
  { _id: "e5", eventType: "config_change",  userEmail: "admin@acme.co.il",    timestamp: new Date(Date.now() - 14400000).toISOString(), severity: "medium" },
];

// ── Helpers ────────────────────────────────────────────────────
const STATUS_COLORS = {
  active:    "bg-green-500/20 text-green-400 border-green-700/40",
  trial:     "bg-blue-500/20 text-blue-400 border-blue-700/40",
  suspended: "bg-red-500/20 text-red-400 border-red-700/40",
  expired:   "bg-slate-500/20 text-slate-400 border-slate-700/40",
};

const STATUS_LABELS = {
  active:    "פעיל",
  trial:     "ניסיון",
  suspended: "מושהה",
  expired:   "פג תוקף",
};

const SEVERITY_COLORS = {
  high:   "text-red-400",
  medium: "text-yellow-400",
  low:    "text-green-400",
  info:   "text-blue-400",
};

const EVENT_LABELS = {
  scan:             "סריקה",
  block:            "חסימה",
  alert:            "התראה",
  agent_connect:    "חיבור סוכן",
  agent_disconnect: "ניתוק סוכן",
  config_change:    "שינוי הגדרות",
  user_action:      "פעולת משתמש",
};

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={handleCopy}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all ${
        copied
          ? "bg-green-500/20 text-green-400 border border-green-500/40"
          : "bg-slate-700/40 text-slate-400 border border-slate-600/40 hover:text-white hover:bg-slate-600/40"
      }`}
    >
      {copied ? <CheckCheck size={10} /> : <Copy size={10} />}
      {copied ? "הועתק" : "העתק"}
    </button>
  );
}

function KpiCard({ label, value, sub, colorClass = "text-cyan-300" }) {
  return (
    <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${colorClass}`}>{value}</p>
      {sub && <p className="text-xs text-slate-600 mt-1">{sub}</p>}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────
export default function ClientDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [client, setClient] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadClient = useCallback(async () => {
    // Try API first
    try {
      const res = await fetch(`/api/tenants/${id}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setClient(data.tenant || data);
        return;
      }
    } catch {}

    // Fall back to demo data
    if (DEMO_CLIENTS[id]) {
      setClient(DEMO_CLIENTS[id]);
    }
  }, [id]);

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetch(`/api/tenant-events?tenantId=${id}&limit=20`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.events?.length) { setEvents(data.events); return; }
      }
    } catch {}
    setEvents(DEMO_EVENTS);
  }, [id]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadClient(), loadEvents()]).finally(() => setLoading(false));
    const interval = setInterval(() => { loadClient(); loadEvents(); }, 30000);
    return () => clearInterval(interval);
  }, [loadClient, loadEvents]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadClient(), loadEvents()]);
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <RefreshCw size={18} className="animate-spin text-cyan-400" />
          <span className="text-sm">טוען נתוני לקוח...</span>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center space-y-4">
          <AlertTriangle size={40} className="text-yellow-400 mx-auto" />
          <p className="text-slate-300 text-sm">לקוח לא נמצא</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="px-4 py-2 bg-cyan-500/20 border border-cyan-600/40 rounded-lg text-sm text-cyan-300 hover:bg-cyan-500/30 transition-colors"
          >
            חזרה ללוח הבקרה
          </button>
        </div>
      </div>
    );
  }

  const isConnected = client.status === "active";

  return (
    <div dir="rtl" className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800/60 bg-[#0a0a0f]/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors text-sm"
          >
            <ArrowRight size={16} />
            <span>חזרה</span>
          </button>
          <span className="text-slate-700">/</span>
          <div className="flex items-center gap-2">
            <Shield className="text-cyan-500" size={16} />
            <span className="text-sm font-bold text-cyan-300 tracking-widest">GhostLayer</span>
          </div>
          <span className="text-slate-700">/</span>
          <span className="text-sm text-slate-300 font-medium">{client.name}</span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/40 rounded-lg text-xs text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          רענן
        </button>
      </header>

      <main className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Client header card */}
        <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                <Building2 className="text-cyan-400" size={24} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">{client.name}</h1>
                <p className="text-slate-400 text-sm mt-0.5">{client.contactEmail || "—"}</p>
                <p className="text-slate-600 text-xs mt-1 font-mono">{client.slug || client._id}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${STATUS_COLORS[client.status] || STATUS_COLORS.trial}`}>
                <Circle size={6} fill="currentColor" />
                {STATUS_LABELS[client.status] || client.status}
              </span>
              <span className="text-xs text-slate-500 px-2 py-1 bg-slate-800/60 rounded-lg border border-slate-700/40">
                {client.plan}
              </span>
            </div>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="סוכנים פעילים"
            value={client.agentCount ?? 0}
            colorClass={isConnected ? "text-green-400" : "text-slate-400"}
          />
          <KpiCard
            label="סריקות סה״כ"
            value={(client.usage?.totalScans ?? 0).toLocaleString("he-IL")}
            colorClass="text-cyan-300"
          />
          <KpiCard
            label="חסימות סה״כ"
            value={(client.usage?.totalBlocks ?? 0).toLocaleString("he-IL")}
            colorClass="text-orange-400"
          />
          <KpiCard
            label="פעיל לאחרונה"
            value={
              client.usage?.lastActivity
                ? new Date(client.usage.lastActivity).toLocaleTimeString("he-IL")
                : "—"
            }
            sub={
              client.usage?.lastActivity
                ? new Date(client.usage.lastActivity).toLocaleDateString("he-IL")
                : undefined
            }
            colorClass="text-blue-300"
          />
        </div>

        {/* API Key & connection status */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* API Key */}
          <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4 space-y-3">
            <h3 className="text-xs text-slate-500 uppercase tracking-wider">מפתח API</h3>
            <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2">
              <code className="flex-1 text-xs text-cyan-300 font-mono truncate" dir="ltr">
                {client.apiKey || "לא הוגדר"}
              </code>
              {client.apiKey && <CopyButton text={client.apiKey} />}
            </div>
            <p className="text-xs text-slate-600">
              השתמש במפתח זה להגדרת סוכני GhostLayer עבור ארגון זה.
            </p>
          </div>

          {/* Connection status */}
          <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4 space-y-3">
            <h3 className="text-xs text-slate-500 uppercase tracking-wider">סטטוס חיבור</h3>
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${isConnected ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]" : "bg-slate-600"}`} />
              <span className={`text-sm font-medium ${isConnected ? "text-green-400" : "text-slate-400"}`}>
                {isConnected ? "מחובר ופעיל" : "לא מחובר"}
              </span>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">שרת DLP</span>
                <span className={isConnected ? "text-green-400" : "text-slate-600"}>
                  {isConnected ? "מחובר" : "מנותק"}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">סוכנים פעילים</span>
                <span className="text-slate-300">{client.agentCount ?? 0}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">תוכנית</span>
                <span className="text-slate-300">{client.plan}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Security events */}
        <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-cyan-400" />
              <h3 className="text-sm text-slate-300 font-medium">אירועי אבטחה מבודדים – {client.name}</h3>
            </div>
            <span className="text-xs text-slate-600">{events.length} אירועים</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="px-4 py-3 text-right text-xs text-slate-500 uppercase tracking-wider">סוג אירוע</th>
                  <th className="px-4 py-3 text-right text-xs text-slate-500 uppercase tracking-wider">משתמש</th>
                  <th className="px-4 py-3 text-right text-xs text-slate-500 uppercase tracking-wider">חומרה</th>
                  <th className="px-4 py-3 text-right text-xs text-slate-500 uppercase tracking-wider">זמן</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-600 text-xs">
                      אין אירועי אבטחה להצגה
                    </td>
                  </tr>
                ) : (
                  events.map((ev) => (
                    <tr key={ev._id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 text-slate-300">
                        {EVENT_LABELS[ev.eventType] || ev.eventType}
                      </td>
                      <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                        {ev.userEmail || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${SEVERITY_COLORS[ev.severity] || "text-slate-400"}`}>
                          {ev.severity || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        {ev.timestamp ? new Date(ev.timestamp).toLocaleString("he-IL") : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Connection instructions */}
        <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Cpu size={14} className="text-cyan-400" />
            <h3 className="text-sm text-slate-300 font-medium">הוראות חיבור סוכן</h3>
          </div>
          <p className="text-xs text-slate-500">
            הרץ פקודה זו על שרת הארגון כדי לחבר סוכן GhostLayer:
          </p>
          <div className="bg-slate-900/60 border border-slate-700/60 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-500">פקודת Node.js</span>
              <CopyButton
                text={`npx ghostlayer-agent --server-url=${process.env.NEXT_PUBLIC_DLP_SERVER_URL || "<SERVER_URL>"} --api-key=${client.apiKey || "<API_KEY>"} --dir=/company/docs --verbose`}
              />
            </div>
            <code className="block text-xs text-green-300 font-mono whitespace-pre-wrap break-all" dir="ltr">
              {`npx ghostlayer-agent --server-url=${process.env.NEXT_PUBLIC_DLP_SERVER_URL || "<SERVER_URL>"} --api-key=${client.apiKey || "<API_KEY>"} --dir=/company/docs --verbose`}
            </code>
          </div>
        </div>
      </main>
    </div>
  );
}
