"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, Clock, Plus } from "lucide-react";
import GhostLogo from "../../components/GhostLogo";
import SuperAdminSidebar from "./components/SuperAdminSidebar";
import GlobalKpiBar      from "./components/GlobalKpiBar";
import TenantsTable      from "./components/TenantsTable";
import AddTenantModal    from "./components/AddTenantModal";
import AgentsGrid        from "./components/AgentsGrid";
import GlobalThreatMap   from "./components/GlobalThreatMap";
import LiveEventsStream  from "./components/LiveEventsStream";
import AgentDetailPanel  from "./components/AgentDetailPanel";
import TenantDetailView  from "./components/TenantDetailView";

// ── System clock ──────────────────────────────────────────────
function SystemClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("he-IL", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-xs text-cyan-400/80 tabular-nums">{time}</span>;
}

// ── Auth gate ──────────────────────────────────────────────────
function AuthGate({ onAuth }) {
  const [key, setKey]   = useState("");
  const [err, setErr]   = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setErr("");
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin-stats", {
        headers: { "x-super-admin-key": key },
      });
      if (res.ok) { onAuth(key); }
      else        { setErr("מפתח שגוי – אינך מורשה"); }
    } catch {
      setErr("שגיאת רשת");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="w-80 bg-[#0d0d14] border border-cyan-900/40 rounded-2xl p-8 space-y-5 shadow-[0_0_60px_rgba(34,211,238,0.07)]">
        <div className="flex items-center gap-3">
          <GhostLogo size={24} className="text-cyan-400" />
          <div>
            <h1 className="text-cyan-300 font-bold text-sm tracking-widest">GHOST</h1>
            <p className="text-slate-500 text-xs">Super Admin</p>
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">מפתח ניהול</label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2.5 text-sm text-slate-200 font-mono outline-none focus:border-cyan-600/60"
            placeholder="SUPER_ADMIN_KEY"
          />
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button
          onClick={submit}
          disabled={!key || loading}
          className="w-full py-2.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-600/40 rounded-lg text-sm text-cyan-300 font-medium transition-colors disabled:opacity-40"
        >
          {loading ? "מאמת..." : "כניסה"}
        </button>
      </div>
    </div>
  );
}

// ── Main dashboard ──────────────────────────────────────────────
export default function SuperAdminPage() {
  const [adminKey, setAdminKey]         = useState(null);
  const [activeTab, setActiveTab]       = useState("overview");
  const [stats, setStats]               = useState(null);
  const [tenants, setTenants]           = useState([]);
  const [showAddTenant, setShowAddTenant] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [notifCount, setNotifCount]     = useState(0);

  const fetchStats = useCallback(async () => {
    if (!adminKey) return;
    try {
      const res = await fetch("/api/super-admin-stats", {
        headers: { "x-super-admin-key": adminKey },
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        setNotifCount(data.recentCriticalEvents?.length || 0);
      }
    } catch {}
  }, [adminKey]);

  const fetchTenants = useCallback(async () => {
    if (!adminKey) return;
    try {
      const res = await fetch("/api/tenants", {
        headers: { "x-super-admin-key": adminKey },
      });
      if (res.ok) setTenants((await res.json()).tenants || []);
    } catch {}
  }, [adminKey]);

  useEffect(() => {
    if (!adminKey) return;
    fetchStats();
    fetchTenants();
    const id = setInterval(() => { fetchStats(); fetchTenants(); }, 15000);
    return () => clearInterval(id);
  }, [adminKey, fetchStats, fetchTenants]);

  const handleSuspend = async (tenant) => {
    const newStatus = tenant.status === "suspended" ? "active" : "suspended";
    try {
      await fetch(`/api/tenants/${tenant._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-super-admin-key": adminKey },
        body: JSON.stringify({ status: newStatus }),
      });
      fetchTenants();
    } catch {}
  };

  const handleDelete = async (tenant) => {
    if (!confirm(`האם למחוק את "${tenant.name}"?`)) return;
    try {
      await fetch(`/api/tenants/${tenant._id}`, {
        method: "DELETE",
        headers: { "x-super-admin-key": adminKey },
      });
      fetchTenants();
    } catch {}
  };

  if (!adminKey) {
    return <AuthGate onAuth={setAdminKey} />;
  }

  const renderContent = () => {
    if (selectedTenant) {
      return (
        <TenantDetailView
          tenant={selectedTenant}
          superAdminKey={adminKey}
          onBack={() => setSelectedTenant(null)}
        />
      );
    }

    switch (activeTab) {
      case "overview":
        return (
          <div className="space-y-5">
            <GlobalKpiBar stats={stats} />
            <GlobalThreatMap stats={stats} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <LiveEventsStream superAdminKey={adminKey} />
              <div className="space-y-4">
                <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
                  <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3">אירועים קריטיים אחרונים</h3>
                  {stats?.recentCriticalEvents?.length === 0 ? (
                    <p className="text-xs text-slate-600">אין אירועים קריטיים</p>
                  ) : (
                    <div className="space-y-2">
                      {(stats?.recentCriticalEvents || []).slice(0, 5).map((e) => (
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
          </div>
        );

      case "tenants":
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">ניהול דיירים</h2>
              <button
                onClick={() => setShowAddTenant(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-600/40 rounded-lg text-sm text-cyan-300 font-medium transition-colors"
              >
                <Plus size={14} /> דייר חדש
              </button>
            </div>
            <TenantsTable
              tenants={tenants}
              onView={setSelectedTenant}
              onEdit={setSelectedTenant}
              onSuspend={handleSuspend}
              onDelete={handleDelete}
            />
          </div>
        );

      case "agents":
        return <AgentsGrid superAdminKey={adminKey} onSelectAgent={setSelectedAgent} />;

      case "events":
        return (
          <div className="h-full">
            <LiveEventsStream superAdminKey={adminKey} />
          </div>
        );

      case "threats":
        return <GlobalThreatMap stats={stats} />;

      default:
        return <GlobalKpiBar stats={stats} />;
    }
  };

  return (
    <div className="flex min-h-screen bg-[#0a0a0f]" dir="rtl">
      <SuperAdminSidebar activeTab={selectedTenant ? "tenants" : activeTab} onTabChange={(t) => { setActiveTab(t); setSelectedTenant(null); }} />

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800/60 bg-[#0a0a0f]/80 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-3">
            <GhostLogo size={18} className="text-cyan-500" />
            <span className="text-sm font-bold text-cyan-300 tracking-widest">GHOST Super Admin</span>
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
          superAdminKey={adminKey}
          onClose={() => setSelectedAgent(null)}
          onUpdated={(updated) => setSelectedAgent(updated)}
          onDeleted={() => { setSelectedAgent(null); fetchStats(); }}
        />
      )}

      {/* Add tenant modal */}
      {showAddTenant && (
        <AddTenantModal
          superAdminKey={adminKey}
          onClose={() => setShowAddTenant(false)}
          onCreated={() => { fetchTenants(); setShowAddTenant(false); }}
        />
      )}
    </div>
  );
}
