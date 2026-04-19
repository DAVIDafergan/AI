"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, Clock, LogOut, Plus, Copy, Check } from "lucide-react";
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

const SUPER_ADMIN_API_PATH = "/api/super-admin-stats";
const SUPER_ADMIN_KEY_STORAGE_KEYS = ["ghostlayer_super_admin_key", "superAdminKey"];
const ENV_TEMPLATE = `# Server public URL (must be HTTPS for the Chrome extension to work)
DLP_SERVER_URL=https://your-server.com

# MongoDB connection string
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/ghostlayer
# Optional fallback tenant API key for remote provisioning when MongoDB is disabled
FALLBACK_TENANT_API_KEY=

# Super Admin credentials
SUPER_ADMIN_KEY=change-me-to-a-long-random-string
SUPER_ADMIN_USERNAME=admin@yourcompany.com
SUPER_ADMIN_PASSWORD=change-me

# JWT secret – generate with:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=

# Comma-separated list of allowed origins for CORS
ALLOWED_ORIGINS=https://your-server.com,chrome-extension://YOUR_EXTENSION_ID`;

function readStoredSuperAdminKey() {
  if (typeof window === "undefined") return "";
  for (const key of SUPER_ADMIN_KEY_STORAGE_KEYS) {
    const fromLocal = localStorage.getItem(key)?.trim();
    if (fromLocal) return fromLocal;
    const fromSession = sessionStorage.getItem(key)?.trim();
    if (fromSession) return fromSession;
  }
  return "";
}

function resolveSuperAdminKey(preferred = "") {
  return preferred?.trim() || readStoredSuperAdminKey();
}

function persistSuperAdminKey(key) {
  if (typeof window === "undefined") return;
  const clean = key?.trim();
  if (!clean) return;
  try { localStorage.setItem("ghostlayer_super_admin_key", clean); } catch {}
  try { sessionStorage.setItem("ghostlayer_super_admin_key", clean); } catch {}
}

function clearPersistedSuperAdminKey() {
  if (typeof window === "undefined") return;
  for (const key of SUPER_ADMIN_KEY_STORAGE_KEYS) {
    try { localStorage.removeItem(key); } catch {}
    try { sessionStorage.removeItem(key); } catch {}
  }
}

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

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <button onClick={handle} className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-cyan-400 transition-colors">
      {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
    </button>
  );
}

function ConnectionSetupPanel() {
  const serverRows = [
    ["Chrome Extension", "Options page (right-click extension → Options)", '"Local Agent URL"'],
    ["Desktop Shield", "Environment variable", "DLP_SERVER_URL"],
    ["On-Premise Agent", "CLI flag", "--saas-url"],
    ["docker-compose.yml", ".env file", "DLP_SERVER_URL"],
  ];

  const apiKeyRows = [
    ["Chrome Extension", "Options page", '"Tenant API Key"'],
    ["Desktop Shield", "Environment variable", "DLP_API_KEY"],
    ["On-Premise Agent", "CLI flag", "--api-key"],
  ];

  const checklist = [
    '☐ Server is running (`curl https://your-server.com/api/health` returns `{"status":"ok"}`)',
    "☐ Server has a public HTTPS URL (not http://, not an internal IP)",
    "☐ .env file is filled and server restarted after changes",
    "☐ Chrome Extension options page: Local Agent URL is set",
    "☐ Chrome Extension options page: Tenant API Key is set",
    '☐ Extension status dot shows green ("מחובר לשרת ✓")',
  ];

  return (
    <div className="space-y-4">
      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4 space-y-2">
        <h2 className="text-sm font-semibold text-slate-200">חיבור והגדרות</h2>
        <p className="text-xs text-slate-400 leading-relaxed">
          מדריך מהיר לחיבור כל הרכיבים לשרת בצורה תקינה.
        </p>
      </div>

      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4 space-y-3">
        <h3 className="text-xs text-slate-300 uppercase tracking-wider">1) Server URL</h3>
        <p className="text-xs text-slate-400">
          כל הרכיבים צריכים כתובת אחת: כתובת HTTPS ציבורית של dlp-server.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700/40">
                <th className="py-2 text-right font-medium">Component</th>
                <th className="py-2 text-right font-medium">Where to set the URL</th>
                <th className="py-2 text-right font-medium">Field/Variable name</th>
              </tr>
            </thead>
            <tbody>
              {serverRows.map(([component, where, field]) => (
                <tr key={component} className="border-b border-slate-800/50 text-slate-200">
                  <td className="py-2">{component}</td>
                  <td className="py-2 text-slate-300">{where}</td>
                  <td className="py-2"><code className="text-cyan-300 font-mono">{field}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-amber-300/90 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2 leading-relaxed">
          If your server is on Google Cloud and only has an internal IP (10.x.x.x), the extension cannot reach it. You must assign an External IP in GCP Console and open port 3000 in Firewall Rules.
        </p>
      </div>

      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4 space-y-3">
        <h3 className="text-xs text-slate-300 uppercase tracking-wider">2) API Key</h3>
        <p className="text-xs text-slate-400">
          לכל Tenant נוצר API Key בזמן יצירה (מוצג פעם אחת בלבד בחלון Add Tenant).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700/40">
                <th className="py-2 text-right font-medium">Component</th>
                <th className="py-2 text-right font-medium">Where to set the API Key</th>
                <th className="py-2 text-right font-medium">Field/Variable name</th>
              </tr>
            </thead>
            <tbody>
              {apiKeyRows.map(([component, where, field]) => (
                <tr key={component} className="border-b border-slate-800/50 text-slate-200">
                  <td className="py-2">{component}</td>
                  <td className="py-2 text-slate-300">{where}</td>
                  <td className="py-2"><code className="text-cyan-300 font-mono">{field}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs text-slate-300 uppercase tracking-wider">3) .env file template</h3>
          <CopyButton text={ENV_TEMPLATE} />
        </div>
        <div className="bg-slate-900/80 border border-slate-700/60 rounded-lg p-3">
          <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap" dir="ltr">{ENV_TEMPLATE}</pre>
        </div>
      </div>

      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4 space-y-3">
        <h3 className="text-xs text-slate-300 uppercase tracking-wider">4) Connection checklist</h3>
        <ul className="space-y-2 text-sm text-slate-200">
          {checklist.map((item) => (
            <li key={item} className="leading-relaxed">{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Auth gate ──────────────────────────────────────────────────
function AuthGate({ onAuth }) {
  const [key, setKey]   = useState(resolveSuperAdminKey());
  const [err, setErr]   = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const requestKey = resolveSuperAdminKey(key);
    if (!requestKey) return;
    setErr("");
    setLoading(true);
    try {
      const res = await fetch(SUPER_ADMIN_API_PATH, {
        headers: { "x-super-admin-key": requestKey },
      });
      if (res.ok) { onAuth(requestKey); }
      else {
        let msg = "מפתח ניהול על שגוי";
        try {
          const d = await res.json();
          msg = d.error || msg;
        } catch {}
        setErr(msg);
      }
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
          <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
            הזן את מפתח ניהול העל (SUPER_ADMIN_KEY) שמוגדר בשרת.
          </p>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button
          onClick={submit}
          disabled={!resolveSuperAdminKey(key) || loading}
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

  useEffect(() => {
    const saved = resolveSuperAdminKey();
    if (saved) setAdminKey(saved);
  }, []);

  const logout = useCallback(() => {
    clearPersistedSuperAdminKey();
    setAdminKey(null);
    setStats(null);
    setTenants([]);
    setSelectedAgent(null);
    setSelectedTenant(null);
  }, []);

  const fetchStats = useCallback(async () => {
    if (!adminKey) return;
    try {
      const res = await fetch(SUPER_ADMIN_API_PATH, {
        headers: { "x-super-admin-key": adminKey },
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        setNotifCount(data.recentCriticalEvents?.length || 0);
      } else if (res.status === 401 || res.status === 403) {
        logout();
      }
    } catch {}
  }, [adminKey, logout]);

  const fetchTenants = useCallback(async () => {
    if (!adminKey) return;
    try {
      const res = await fetch("/api/tenants", {
        headers: { "x-super-admin-key": adminKey },
      });
      if (res.ok) setTenants((await res.json()).tenants || []);
      else if (res.status === 401 || res.status === 403) logout();
    } catch {}
  }, [adminKey, logout]);

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
      const res = await fetch(`/api/tenants/${tenant._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-super-admin-key": adminKey },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) fetchTenants();
      else if (res.status === 401 || res.status === 403) logout();
    } catch {}
  };

  const handleDelete = async (tenant) => {
    if (!confirm(`האם למחוק את "${tenant.name}"?`)) return;
    try {
      const res = await fetch(`/api/tenants/${tenant._id}`, {
        method: "DELETE",
        headers: { "x-super-admin-key": adminKey },
      });
      if (res.ok) fetchTenants();
      else if (res.status === 401 || res.status === 403) logout();
    } catch {}
  };

  if (!adminKey) {
    return <AuthGate onAuth={(key) => { persistSuperAdminKey(key); setAdminKey(key); }} />;
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

      case "connection":
        return <ConnectionSetupPanel />;

      default:
        return <GlobalKpiBar stats={stats} />;
    }
  };

  return (
    <div className="flex min-h-screen bg-[#0a0a0f]" dir="rtl">
      <SuperAdminSidebar
        activeTab={selectedTenant ? "tenants" : activeTab}
        onTabChange={(t) => { setActiveTab(t); setSelectedTenant(null); }}
        onLogout={logout}
      />

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
            <button
              onClick={logout}
              className="p-1.5 rounded-lg hover:bg-red-900/30 transition-colors text-slate-500 hover:text-red-400"
              title="יציאה"
            >
              <LogOut size={15} />
            </button>
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
