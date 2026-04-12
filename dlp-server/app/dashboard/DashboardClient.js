"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Bell, Clock, Plus, Building2, Settings, LogOut, RefreshCw, Activity, Users, AlertTriangle, Wifi, WifiOff } from "lucide-react";
import { logoutAction } from "../actions/auth";
import TenantsTable from "../super-admin/components/TenantsTable";
import AddTenantModal from "../super-admin/components/AddTenantModal";
import TenantDetailView from "../super-admin/components/TenantDetailView";
import GlobalKpiBar from "../super-admin/components/GlobalKpiBar";
import GlobalThreatMap from "../super-admin/components/GlobalThreatMap";
import LiveEventsStream from "../super-admin/components/LiveEventsStream";
import AgentsGrid from "../super-admin/components/AgentsGrid";
import AgentDetailPanel from "../super-admin/components/AgentDetailPanel";
import GhostLogo from "../../components/GhostLogo";

const REFRESH_INTERVAL_MS = 10000;

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

// ── Connection status indicator ──────────────────────────────────
function ConnectionStatus({ connected, streaming }) {
  if (streaming) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-emerald-400">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
        </span>
        חי
      </span>
    );
  }
  if (connected) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-cyan-400/80">
        <Wifi size={12} />
        מחובר
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-red-400/80">
      <WifiOff size={12} />
      מתחבר מחדש…
    </span>
  );
}

// ── Refresh countdown ─────────────────────────────────────────────
function RefreshCountdown({ onRefresh, isLoading }) {
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_MS / 1000);
  const countRef = useRef(REFRESH_INTERVAL_MS / 1000);

  useEffect(() => {
    countRef.current = REFRESH_INTERVAL_MS / 1000;
    setCountdown(REFRESH_INTERVAL_MS / 1000);
    const id = setInterval(() => {
      countRef.current -= 1;
      setCountdown(countRef.current);
      if (countRef.current <= 0) {
        countRef.current = REFRESH_INTERVAL_MS / 1000;
        setCountdown(REFRESH_INTERVAL_MS / 1000);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [isLoading]);

  return (
    <button
      onClick={onRefresh}
      title="רענן נתונים"
      className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors"
    >
      <RefreshCw size={12} className={isLoading ? "animate-spin text-cyan-400" : ""} />
      <span className="tabular-nums text-slate-500">{countdown}s</span>
    </button>
  );
}

// ── Toast notification ────────────────────────────────────────────
function Toast({ message, type = "info", onClose }) {
  useEffect(() => {
    const id = setTimeout(onClose, 3000);
    return () => clearTimeout(id);
  }, [onClose]);

  const colors = {
    success: "bg-green-900/80 border-green-500/40 text-green-300",
    error: "bg-red-900/80 border-red-500/40 text-red-300",
    info: "bg-cyan-900/80 border-cyan-500/40 text-cyan-300",
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`fixed bottom-4 left-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg border text-xs font-medium shadow-xl animate-in slide-in-from-bottom ${colors[type]}`}
    >
      {type === "success" && "✓ "}
      {type === "error" && "✗ "}
      {message}
    </div>
  );
}

// ── Sidebar ─────────────────────────────────────────────────────
const SIDEBAR_ITEMS = [
  { id: "clients",  label: "ניהול לקוחות",      icon: Building2 },
  { id: "add",      label: "הוספת לקוח חדש",    icon: Plus },
  { id: "agents",   label: "סוכנים",             icon: Activity },
  { id: "settings", label: "הגדרות מערכת",       icon: Settings },
];

function Sidebar({ activeTab, onTabChange, onAddClient }) {
  return (
    <aside className="flex flex-col bg-[#0d0d14] border-l border-cyan-900/30 w-56 min-h-screen shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-cyan-900/30">
        <GhostLogo size={22} className="text-cyan-400 shrink-0" />
        <span className="text-cyan-300 font-bold text-sm tracking-widest whitespace-nowrap">GHOST</span>
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

// ── Skeleton loader ───────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div role="status" aria-label="Loading..." className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-5 animate-pulse">
      <div className="h-3 w-24 bg-slate-700/60 rounded mb-3" />
      <div className="h-8 w-16 bg-slate-700/60 rounded" />
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

// ── System Settings view ─────────────────────────────────────────
function SystemSettings() {
  return (
    <div className="space-y-6">
      <h2 className="text-sm font-semibold text-slate-200">הגדרות מערכת</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { label: "גרסת המערכת", value: "GHOST v3.0.0" },
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

// ── Main dashboard client component ─────────────────────────────
export default function DashboardClient({ initialClients = [] }) {
  const [activeTab, setActiveTab]           = useState("clients");
  const [clients, setClients]               = useState(initialClients);
  const [stats, setStats]                   = useState(null);
  const [isLoading, setIsLoading]           = useState(false);
  const [showAddClient, setShowAddClient]   = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedAgent, setSelectedAgent]   = useState(null);
  const [notifCount, setNotifCount]         = useState(0);
  const [toast, setToast]                   = useState(null);
  const [sseConnected, setSseConnected]     = useState(false);
  const isInitialLoad                       = useRef(true);
  const sseRef                              = useRef(null);
  // Keep stable refs so the SSE callbacks always call the latest version
  // of fetchClients/fetchStats without requiring them as effect dependencies.
  const fetchClientsRef                     = useRef(null);
  const fetchStatsRef                       = useRef(null);

  const showToast = useCallback((message, type = "info") => {
    setToast({ message, type });
  }, []);

  // Redirect to login on 401 (session expired / not authenticated).
  const handleUnauthorized = useCallback(() => {
    window.location.replace("/");
  }, []);

  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch("/api/tenants", { cache: "no-store" });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (res.ok) {
        const data = await res.json();
        if (data.tenants) setClients(data.tenants);
      }
    } catch {
      // keep current clients on error
    }
  }, [handleUnauthorized]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/super-admin-stats", { cache: "no-store" });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        setNotifCount(data.recentCriticalEvents?.length || 0);
      }
    } catch {}
  }, [handleUnauthorized]);

  // Keep refs up-to-date so SSE callbacks never hold stale closures.
  fetchClientsRef.current = fetchClients;
  fetchStatsRef.current   = fetchStats;

  const refreshAll = useCallback(async (showFeedback = false) => {
    setIsLoading(true);
    await Promise.all([fetchClients(), fetchStats()]);
    setIsLoading(false);
    if (showFeedback) showToast("נתונים עודכנו בהצלחה", "success");
  }, [fetchClients, fetchStats, showToast]);

  // ── SSE connection for real-time push ──────────────────────────
  useEffect(() => {
    let es;
    let retryTimer;

    function connect() {
      es = new EventSource("/api/events/stream");
      sseRef.current = es;

      es.addEventListener("open", () => setSseConnected(true));

      es.addEventListener("stats", (e) => {
        try {
          const data = JSON.parse(e.data);
          // Merge SSE stats with existing full stats (SSE sends a subset)
          setStats((prev) => prev ? { ...prev, ...data } : data);
        } catch {}
      });

      es.addEventListener("events", () => {
        // New events arrived – use ref to avoid stale closure.
        fetchClientsRef.current?.();
      });

      es.addEventListener("error", () => {
        setSseConnected(false);
        es.close();
        // Reconnect after 5 s and trigger a manual data refresh.
        retryTimer = setTimeout(() => {
          fetchStatsRef.current?.();
          connect();
        }, 5000);
      });
    }

    connect();

    return () => {
      es?.close();
      clearTimeout(retryTimer);
    };
  }, []); // effect runs once; callbacks accessed via stable refs

  // ── Fallback polling (runs even when SSE is active to keep data fresh) ──
  useEffect(() => {
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      refreshAll();
    }
    const id = setInterval(() => refreshAll(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshAll]);

  const handleSuspend = async (client) => {
    const newStatus = client.status === "suspended" ? "active" : "suspended";
    try {
      await fetch(`/api/tenants/${client._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      await fetchClients();
      showToast(`סטטוס "${client.name}" עודכן`, "success");
    } catch {
      showToast("שגיאה בעדכון הסטטוס", "error");
    }
  };

  const handleDelete = async (client) => {
    if (!confirm(`האם למחוק את "${client.name}"?`)) return;
    try {
      await fetch(`/api/tenants/${client._id}`, { method: "DELETE" });
      await fetchClients();
      showToast(`"${client.name}" נמחק`, "success");
    } catch {
      showToast("שגיאה במחיקת הלקוח", "error");
    }
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
            {stats ? <GlobalKpiBar stats={stats} /> : <KpiSkeleton />}

            {/* Clients master table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-200">טבלת לקוחות ראשית</h2>
                  <span className="text-xs text-slate-500 bg-slate-800/60 border border-slate-700/40 rounded-full px-2 py-0.5">{clients.length}</span>
                </div>
                <button
                  onClick={() => setShowAddClient(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-600/40 rounded-lg text-sm text-cyan-300 font-medium transition-colors"
                >
                  <Plus size={14} /> + הוסף לקוח חדש
                </button>
              </div>
              {isLoading && clients.length === 0 ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-14 bg-[#0d0d14] border border-slate-700/40 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : clients.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 bg-[#0d0d14] border border-slate-700/40 rounded-xl text-center">
                  <Building2 className="text-slate-600 mb-4" size={40} />
                  <p className="text-slate-400 text-sm font-medium">אין לקוחות פעילים עדיין</p>
                  <button
                    onClick={() => setShowAddClient(true)}
                    className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-600/40 rounded-lg text-sm text-cyan-300 font-medium transition-colors"
                  >
                    <Plus size={14} /> הוסף לקוח ראשון
                  </button>
                </div>
              ) : (
                <TenantsTable
                  tenants={clients}
                  onView={setSelectedClient}
                  onEdit={setSelectedClient}
                  onSuspend={handleSuspend}
                  onDelete={handleDelete}
                />
              )}
            </div>

            {/* Live events & recent critical events */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <LiveEventsStream superAdminKey="" />
              <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={14} className="text-red-400" />
                  <h3 className="text-xs text-slate-500 uppercase tracking-wider">אירועים קריטיים אחרונים</h3>
                  {(stats?.recentCriticalEvents?.length || 0) > 0 && (
                    <span className="ml-auto text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/30 rounded-full px-2 py-0.5">
                      {stats.recentCriticalEvents.length}
                    </span>
                  )}
                </div>
                {!stats?.recentCriticalEvents?.length ? (
                  <p className="text-xs text-slate-600 text-center py-4">אין אירועים קריטיים ✓</p>
                ) : (
                  <div className="space-y-1.5">
                    {stats.recentCriticalEvents.slice(0, 5).map((e) => (
                      <div key={e._id} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg border border-red-900/30 bg-red-900/10">
                        <span className="text-red-400 font-medium">{e.eventType}</span>
                        <span className="text-slate-400 truncate max-w-[140px] font-mono" title={e.userEmail || "—"}>{e.userEmail || "—"}</span>
                        <span className="text-slate-600 shrink-0">{e.timestamp ? new Date(e.timestamp).toLocaleTimeString("he-IL") : ""}</span>
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
            <GhostLogo size={18} className="text-cyan-500" />
            <span className="text-sm font-bold text-cyan-300 tracking-widest">GHOST – פורטל ניהול מנהל-על</span>
          </div>
          <div className="flex items-center gap-4">
            <ConnectionStatus connected={true} streaming={sseConnected} />
            <SystemClock />
            <RefreshCountdown onRefresh={() => refreshAll(true)} isLoading={isLoading} />
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

      {/* Toast notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

