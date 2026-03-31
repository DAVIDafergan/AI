"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, Clock, Plus, Shield, Building2, Settings, LogOut } from "lucide-react";
import { logoutAction } from "../actions/auth";
import TenantsTable from "../super-admin/components/TenantsTable";
import AddTenantModal from "../super-admin/components/AddTenantModal";
import TenantDetailView from "../super-admin/components/TenantDetailView";
import GlobalKpiBar from "../super-admin/components/GlobalKpiBar";
import GlobalThreatMap from "../super-admin/components/GlobalThreatMap";
import LiveEventsStream from "../super-admin/components/LiveEventsStream";
import AgentsGrid from "../super-admin/components/AgentsGrid";
import AgentDetailPanel from "../super-admin/components/AgentDetailPanel";

// ── Dummy clients (fallback when API is unavailable) ───────────
const DUMMY_CLIENTS = [
  {
    _id: "dummy-1",
    name: "אקמה בעמ",
    status: "active",
    plan: "enterprise",
    agentCount: 12,
    apiKey: "gl-key-acme-7f3a9b2c",
    usage: { totalScans: 14820, totalBlocks: 237, lastActivity: new Date(Date.now() - 3600000).toISOString() },
  },
  {
    _id: "dummy-2",
    name: "טק-ווב מערכות",
    status: "trial",
    plan: "professional",
    agentCount: 4,
    apiKey: "gl-key-techweb-4d1e8f",
    usage: { totalScans: 3210, totalBlocks: 45, lastActivity: new Date(Date.now() - 7200000).toISOString() },
  },
  {
    _id: "dummy-3",
    name: "גלובל-נט תקשורת",
    status: "suspended",
    plan: "starter",
    agentCount: 0,
    apiKey: "gl-key-globalnet-9c2d5a",
    usage: { totalScans: 891, totalBlocks: 8, lastActivity: new Date(Date.now() - 86400000 * 3).toISOString() },
  },
];

// ── System clock ────────────────────────────────────────────────
function SystemClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("he-IL", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="flex items-center gap-1.5 font-mono text-xs text-cyan-400/80 tabular-nums">
      <Clock size={12} />
      {time}
    </span>
  );
}

// ── Sidebar ─────────────────────────────────────────────────────
const SIDEBAR_ITEMS = [
  { id: "clients",  label: "ניהול לקוחות",      icon: Building2 },
  { id: "add",      label: "הוספת לקוח חדש",    icon: Plus },
  { id: "settings", label: "הגדרות מערכת",       icon: Settings },
];

function Sidebar({ activeTab, onTabChange, onAddClient }) {
  return (
    <aside className="flex flex-col bg-[#0d0d14] border-l border-cyan-900/30 w-56 min-h-screen shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-cyan-900/30">
        <Shield className="text-cyan-400 shrink-0" size={22} />
        <span className="text-cyan-300 font-bold text-sm tracking-widest whitespace-nowrap">GhostLayer</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-1 px-2">
        {SIDEBAR_ITEMS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => (id === "add" ? onAddClient() : onTabChange(id))}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 text-right ${
                active
                  ? "bg-cyan-500/10 text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.25)]"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
              }`}
            >
              <Icon size={18} className={active ? "text-cyan-400" : ""} />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-2 pb-4">
        <form action={logoutAction}>
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-colors text-sm"
          >
            <LogOut size={16} />
            <span>יציאה</span>
          </button>
        </form>
      </div>
    </aside>
  );
}

// ── System Settings view ─────────────────────────────────────────
function SystemSettings() {
  return (
    <div className="space-y-6">
      <h2 className="text-sm font-semibold text-slate-200">הגדרות מערכת</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { label: "גרסת המערכת", value: "GhostLayer v3.0.0" },
          { label: "מסד נתונים", value: "MongoDB Atlas" },
          { label: "ספק אימות", value: "Cookie-based (HTTP-only)" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className="text-sm text-slate-200 font-medium">{value}</p>
          </div>
        ))}
      </div>
      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
        <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3">מדיניות אבטחה</h3>
        <ul className="space-y-2 text-sm text-slate-300">
          <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-400" />הצפנת נתונים בהעברה (TLS 1.3)</li>
          <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-400" />עוגיית HTTP-only להגנה על הסשן</li>
          <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-400" />אימות מבוסס מפתח API לכל לקוח</li>
          <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-yellow-400" />ניתוק אוטומטי לאחר 8 שעות</li>
        </ul>
      </div>
    </div>
  );
}

// ── Main dashboard ───────────────────────────────────────────────
export default function DashboardPage() {
  const [activeTab, setActiveTab]           = useState("clients");
  const [clients, setClients]               = useState(DUMMY_CLIENTS);
  const [stats, setStats]                   = useState(null);
  const [showAddClient, setShowAddClient]   = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedAgent, setSelectedAgent]   = useState(null);
  const [notifCount, setNotifCount]         = useState(0);

  // Try to load real tenants from API (without requiring super-admin key – we are already authenticated via cookie)
  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch("/api/tenants", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.tenants?.length) setClients(data.tenants);
      }
    } catch {
      // fall back to dummy data
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/super-admin-stats", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        setNotifCount(data.recentCriticalEvents?.length || 0);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchClients();
    fetchStats();
    const id = setInterval(() => { fetchClients(); fetchStats(); }, 15000);
    return () => clearInterval(id);
  }, [fetchClients, fetchStats]);

  const handleSuspend = async (client) => {
    const newStatus = client.status === "suspended" ? "active" : "suspended";
    try {
      await fetch(`/api/tenants/${client._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      fetchClients();
    } catch {}
  };

  const handleDelete = async (client) => {
    if (!confirm(`האם למחוק את "${client.name}"?`)) return;
    try {
      await fetch(`/api/tenants/${client._id}`, { method: "DELETE" });
      fetchClients();
    } catch {}
  };

  const renderContent = () => {
    if (selectedClient) {
      return (
        <TenantDetailView
          tenant={selectedClient}
          superAdminKey=""
          onBack={() => setSelectedClient(null)}
        />
      );
    }

    switch (activeTab) {
      case "clients":
        return (
          <div className="space-y-5">
            {/* KPI bar */}
            {stats && <GlobalKpiBar stats={stats} />}

            {/* Clients master table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">טבלת לקוחות ראשית</h2>
                <button
                  onClick={() => setShowAddClient(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-600/40 rounded-lg text-sm text-cyan-300 font-medium transition-colors"
                >
                  <Plus size={14} /> + הוסף לקוח חדש
                </button>
              </div>
              <TenantsTable
                tenants={clients}
                onView={setSelectedClient}
                onEdit={setSelectedClient}
                onSuspend={handleSuspend}
                onDelete={handleDelete}
              />
            </div>

            {/* Live events & recent critical events */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <LiveEventsStream superAdminKey="" />
              <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
                <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3">אירועים קריטיים אחרונים</h3>
                {!stats?.recentCriticalEvents?.length ? (
                  <p className="text-xs text-slate-600">אין אירועים קריטיים</p>
                ) : (
                  <div className="space-y-2">
                    {stats.recentCriticalEvents.slice(0, 5).map((e) => (
                      <div key={e._id} className="flex items-center justify-between text-xs py-1 border-b border-slate-800/40">
                        <span className="text-red-400">{e.eventType}</span>
                        <span className="text-slate-400">{e.userEmail || "—"}</span>
                        <span className="text-slate-600">{e.timestamp ? new Date(e.timestamp).toLocaleTimeString("he-IL") : ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case "agents":
        return <AgentsGrid superAdminKey="" onSelectAgent={setSelectedAgent} />;

      case "settings":
        return <SystemSettings />;

      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-screen bg-[#0a0a0f]" dir="rtl">
      <Sidebar
        activeTab={selectedClient ? "clients" : activeTab}
        onTabChange={(t) => { setActiveTab(t); setSelectedClient(null); }}
        onAddClient={() => setShowAddClient(true)}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800/60 bg-[#0a0a0f]/80 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-3">
            <Shield className="text-cyan-500" size={18} />
            <span className="text-sm font-bold text-cyan-300 tracking-widest">GhostLayer – פורטל ניהול מנהל-על</span>
          </div>
          <div className="flex items-center gap-4">
            <SystemClock />
            <div className="relative">
              <button className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-200">
                <Bell size={15} />
              </button>
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 text-[9px] font-bold flex items-center justify-center rounded-full bg-red-500 text-white">
                  {notifCount > 9 ? "9+" : notifCount}
                </span>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {renderContent()}
        </main>
      </div>

      {/* Agent detail slide-in panel */}
      {selectedAgent && (
        <AgentDetailPanel
          agent={selectedAgent}
          superAdminKey=""
          onClose={() => setSelectedAgent(null)}
          onUpdated={(updated) => setSelectedAgent(updated)}
        />
      )}

      {/* Add client modal */}
      {showAddClient && (
        <AddTenantModal
          superAdminKey=""
          onClose={() => setShowAddClient(false)}
          onCreated={() => { fetchClients(); setShowAddClient(false); }}
        />
      )}
    </div>
  );
}
