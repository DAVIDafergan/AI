"use client";

// דף ראשי של ה-Admin Dashboard – CISO Enterprise Dashboard
import { useState, useEffect, useCallback } from "react";
import { Shield, AlertTriangle, Star, Users, TrendingUp, Bell, Settings, Tag, BarChart3, Gauge, Brain, Activity, Network, Building2 } from "lucide-react";
import KpiCard from "./components/KpiCard";
import BlocksBarChart from "./components/BlocksBarChart";
import CategoryPieChart from "./components/CategoryPieChart";
import LiveLogsTable from "./components/LiveLogsTable";
import PolicySettings from "./components/PolicySettings";
import ExportButton from "./components/ExportButton";
import TrendLineChart from "./components/TrendLineChart";
import AlertsPanel from "./components/AlertsPanel";
import OrganizationSelector from "./components/OrganizationSelector";
import ThreatScoreGauge from "./components/ThreatScoreGauge";
import CustomKeywordsManager from "./components/CustomKeywordsManager";
import ExportPdfButton from "./components/ExportPdfButton";
import UsersTable from "./components/UsersTable";
import ClientOnboardingWizard from "./components/ClientOnboardingWizard";

// מסך טעינה – שלד אנימטיבי
function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-slate-900 border border-slate-700/50 rounded-xl h-32" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-700/50 rounded-xl h-80" />
        <div className="bg-slate-900 border border-slate-700/50 rounded-xl h-80" />
      </div>
      <div className="bg-slate-900 border border-slate-700/50 rounded-xl h-64" />
    </div>
  );
}

// ── GhostLayer Status Panel ──────────────────────────────────────────────────
function GhostLayerPanel({ health }) {
  if (!health) return null;
  const { triage = {} } = health;
  const layers = [
    { name: "L1 – סריקה מהירה (Regex)",   hits: triage.l1Hits || 0, rate: triage.l1HitRate || "0.0", color: "text-green-400", bg: "bg-green-500/10 border-green-500/30" },
    { name: "L2 – Hash Signatures",         hits: triage.l2Hits || 0, rate: triage.l2HitRate || "0.0", color: "text-blue-400",  bg: "bg-blue-500/10 border-blue-500/30"  },
    { name: "L3 – ניתוח קונטקסטואלי (NLP)", hits: triage.l3Hits || 0, rate: triage.l3HitRate || "0.0", color: "text-purple-400",bg: "bg-purple-500/10 border-purple-500/30"},
  ];
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-white flex items-center gap-2">
        🛡️ GhostLayer Status
        <span className="text-sm font-normal text-slate-400">
          ({triage.totalRuns || 0} סריקות סה״כ)
        </span>
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {layers.map((layer) => (
          <div key={layer.name} className={`rounded-xl border p-4 ${layer.bg}`}>
            <p className="text-xs text-slate-400 mb-1">{layer.name}</p>
            <p className={`text-2xl font-bold ${layer.color}`}>{layer.hits}</p>
            <p className="text-xs text-slate-500 mt-1">שיעור זיהוי: {layer.rate}%</p>
          </div>
        ))}
      </div>
      <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 text-sm text-slate-300">
        <span className="font-semibold text-white">סה״כ חסימות: </span>
        {triage.totalUnsafe || 0} {' | '}
        <span className="font-semibold text-white">סריקות: </span>
        {triage.totalRuns || 0}
      </div>
    </div>
  );
}

// ── Knowledge Graph Manager ──────────────────────────────────────────────────
function KnowledgeGraphManager() {
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [newText, setNewText] = useState("");
  const [newCategory, setNewCategory] = useState("CUSTOM");
  const [msg, setMsg] = useState("");

  const fetchEntities = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge-graph");
      if (!res.ok) return;
      const data = await res.json();
      setEntities(data.entities || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEntities(); }, [fetchEntities]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!newText.trim()) return;
    const res = await fetch("/api/knowledge-graph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: newText.trim(), category: newCategory }),
    });
    if (res.ok) {
      setMsg("✅ ישות נוספה");
      setNewText("");
      fetchEntities();
      setTimeout(() => setMsg(""), 2000);
    }
  }

  async function handleDelete(id) {
    const res = await fetch(`/api/knowledge-graph?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) { fetchEntities(); }
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    const res = await fetch(`/api/knowledge-graph?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await res.json();
      setResults(data.results || []);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-white flex items-center gap-2">
        🕸️ Knowledge Graph Manager
        <span className="text-sm font-normal text-slate-400">({entities.length} ישויות)</span>
      </h2>

      {/* הוספת ישות */}
      <form onSubmit={handleAdd} className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="טקסט רגיש לאינדוס..."
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500"
          dir="rtl"
        />
        <select
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500"
        >
          {["CUSTOM", "PHONE", "EMAIL", "ID", "PASSWORD", "CREDIT_CARD", "ADDRESS", "PROJECT", "SECRET"].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors">
          הוסף
        </button>
        {msg && <span className="self-center text-green-400 text-sm">{msg}</span>}
      </form>

      {/* חיפוש דמיון */}
      <form onSubmit={handleSearch} className="flex gap-3">
        <input
          type="text"
          placeholder="חיפוש ישויות דומות..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-purple-500"
          dir="rtl"
        />
        <button type="submit" className="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors">
          חפש
        </button>
        {results !== null && <button type="button" onClick={() => setResults(null)} className="text-slate-400 text-sm underline">נקה</button>}
      </form>

      {/* תוצאות חיפוש */}
      {results !== null && (
        <div className="bg-slate-900/50 border border-purple-500/30 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-purple-300 mb-2">תוצאות דמיון ({results.length}):</p>
          {results.length === 0
            ? <p className="text-slate-400 text-sm">לא נמצאו ישויות דומות</p>
            : results.map((r) => (
              <div key={r.id} className="flex justify-between text-sm text-slate-300">
                <span dir="rtl">{r.text}</span>
                <span className="text-purple-400 font-mono">{(r.similarity * 100).toFixed(1)}%</span>
              </div>
            ))
          }
        </div>
      )}

      {/* רשימת ישויות */}
      {loading ? (
        <div className="animate-pulse space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="bg-slate-800 h-10 rounded-xl" />)}</div>
      ) : entities.length === 0 ? (
        <div className="text-center text-slate-400 py-8">אין ישויות רשומות עדיין</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60 border-b border-slate-700/50">
                <th className="text-right px-4 py-3 font-semibold text-slate-300">טקסט</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-300">קטגוריה</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-300">נוצר</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-300">מחיקה</th>
              </tr>
            </thead>
            <tbody>
              {entities.map((e) => (
                <tr key={e.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                  <td className="px-4 py-3 text-slate-200" dir="rtl">{e.text}</td>
                  <td className="px-4 py-3 text-center"><span className="bg-slate-700 text-slate-200 text-xs px-2 py-1 rounded-full">{e.category}</span></td>
                  <td className="px-4 py-3 text-center text-slate-400 text-xs">{new Date(e.addedAt).toLocaleDateString("he-IL")}</td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => handleDelete(e.id)} className="text-rose-400 hover:text-rose-300 text-xs underline">מחק</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── System Health Monitor ────────────────────────────────────────────────────
function SystemHealthMonitor({ health }) {
  if (!health) {
    return (
      <div className="text-center text-slate-400 py-8">
        <p>לא ניתן לטעון נתוני בריאות מערכת</p>
      </div>
    );
  }

  const isHealthy = health.status === "healthy";
  const memPercent = Math.min(100, Math.round((health.memory?.heapUsedMB || 0) / 512 * 100));

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-white flex items-center gap-2">
        💓 System Health Monitor
        <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${isHealthy ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
          {isHealthy ? "תקין ✓" : "תקלה ✗"}
        </span>
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
          <p className="text-xs text-slate-400">API Latency</p>
          <p className="text-2xl font-bold text-white">{health.latency?.total || 0}ms</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
          <p className="text-xs text-slate-400">שימוש זיכרון</p>
          <p className="text-2xl font-bold text-white">{health.memory?.heapUsedMB || 0}MB</p>
          <div className="w-full bg-slate-700 rounded-full h-1.5 mt-2">
            <div className={`h-1.5 rounded-full ${memPercent > 80 ? "bg-red-500" : "bg-green-500"}`} style={{ width: `${memPercent}%` }} />
          </div>
        </div>
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
          <p className="text-xs text-slate-400">Uptime</p>
          <p className="text-2xl font-bold text-white">{Math.floor((health.uptime || 0) / 60)}m</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
          <p className="text-xs text-slate-400">סביבה</p>
          <p className="text-lg font-bold text-white capitalize">{health.environment || "—"}</p>
        </div>
      </div>

      <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 space-y-2 text-sm">
        <div className="flex justify-between text-slate-300">
          <span>גרסה:</span><span className="font-mono">{health.version || "—"}</span>
        </div>
        <div className="flex justify-between text-slate-300">
          <span>DB Latency:</span><span className="font-mono">{health.latency?.db || 0}ms</span>
        </div>
        <div className="flex justify-between text-slate-300">
          <span>Knowledge Graph:</span><span>{health.knowledgeGraph?.totalEntities || 0} ישויות</span>
        </div>
        <div className="flex justify-between text-slate-300">
          <span>חסימות כלל:</span><span>{health.store?.totalBlocked || 0}</span>
        </div>
        <div className="flex justify-between text-slate-300 text-xs text-slate-500">
          <span>עדכון אחרון:</span>
          <span>{health.timestamp ? new Date(health.timestamp).toLocaleTimeString("he-IL") : "—"}</span>
        </div>
      </div>
    </div>
  );
}

// הגדרות טאבים
const TABS = [
  { id: "overview",      label: "סקירה כללית",   icon: BarChart3  },
  { id: "trends",        label: "מגמות",          icon: TrendingUp },
  { id: "alerts",        label: "התראות",         icon: Bell       },
  { id: "users",         label: "משתמשים",        icon: Users      },
  { id: "ghostlayer",    label: "GhostLayer",     icon: Shield     },
  { id: "knowledge",     label: "Knowledge Graph", icon: Network    },
  { id: "health",        label: "בריאות מערכת",   icon: Activity   },
  { id: "clients",       label: "ניהול לקוחות",   icon: Building2  },
  { id: "settings",      label: "הגדרות",         icon: Settings   },
  { id: "keywords",      label: "מילים מותאמות",  icon: Tag        },
];

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [trendData, setTrendData] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [health, setHealth] = useState(null);

  // מצב ניהול לקוחות
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [deletingClientId, setDeletingClientId] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);

  // טעינת רשימת לקוחות
  const fetchClients = useCallback(async () => {
    setClientsLoading(true);
    try {
      const res = await fetch("/api/clients");
      if (!res.ok) return;
      const data = await res.json();
      setClients(data.clients || []);
    } catch {
      // שגיאת רשת – המשך
    } finally {
      setClientsLoading(false);
    }
  }, []);

  // מחיקת לקוח
  async function handleDeleteClient(orgId) {
    if (!confirm("האם למחוק את הלקוח? פעולה זו בלתי הפיכה.")) return;
    setDeletingClientId(orgId);
    try {
      const res = await fetch(`/api/clients?id=${encodeURIComponent(orgId)}`, { method: "DELETE" });
      if (res.ok) fetchClients();
    } finally {
      setDeletingClientId(null);
    }
  }

  // העתקת API Key
  async function handleCopyKey(key) {
    await navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  // טעינת סטטיסטיקות
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("שגיאה בטעינת הנתונים");
      const data = await res.json();
      setStats(data);
      setPolicies(data.policySettings || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // טעינת מגמות
  const fetchTrends = useCallback(async () => {
    try {
      const res = await fetch("/api/trend-data");
      if (!res.ok) return;
      const data = await res.json();
      setTrendData(data);
    } catch {
      // שגיאת רשת – המשך
    }
  }, []);

  // טעינת מספר התראות שלא נקראו
  const fetchAlertCount = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts");
      if (!res.ok) return;
      const data = await res.json();
      setUnreadAlerts(data.unreadCount || 0);
    } catch {
      // שגיאת רשת
    }
  }, []);

  // טעינת בריאות מערכת
  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) return;
      const data = await res.json();
      setHealth(data);
    } catch {
      // שגיאת רשת
    }
  }, []);

  // טעינה ראשונית
  useEffect(() => {
    fetchStats();
    fetchTrends();
    fetchAlertCount();
    fetchHealth();
    fetchClients();
  }, [fetchStats, fetchTrends, fetchAlertCount, fetchHealth, fetchClients]);

  // Auto-refresh כל 30 שניות
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStats();
      fetchAlertCount();
      fetchHealth();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchStats, fetchAlertCount, fetchHealth]);

  // עדכון מדיניות דרך API
  async function handleTogglePolicy(id) {
    const policy = policies.find((p) => p.id === id);
    if (!policy) return;
    const newEnabled = !policy.enabled;
    try {
      await fetch("/api/policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled: newEnabled }),
      });
      setPolicies((prev) =>
        prev.map((p) => (p.id === id ? { ...p, enabled: newEnabled } : p))
      );
    } catch {
      // fallback: עדכון מקומי בלבד
      setPolicies((prev) =>
        prev.map((p) => (p.id === id ? { ...p, enabled: newEnabled } : p))
      );
    }
  }

  // קטגוריות ייחודיות מהלוגים
  const uniqueCategories = stats?.recentLogs
    ? ["all", ...new Set(stats.recentLogs.map((l) => l.type))]
    : ["all"];

  return (
    <main className="min-h-screen bg-slate-950 text-white" dir="rtl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* כותרת עליונה */}
        <header className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-500/10 rounded-xl">
              <Shield className="w-8 h-8 text-rose-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white leading-tight">DLP Shield</h1>
              <p className="text-slate-400 text-sm">Enterprise CISO Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <OrganizationSelector />
            <ExportPdfButton />
            <ExportButton logs={stats?.recentLogs || []} />
          </div>
        </header>

        {/* מצב שגיאה */}
        {error && (
          <div className="bg-rose-900/30 border border-rose-500/50 rounded-xl p-4 mb-6 text-rose-400 text-sm">
            {error}
          </div>
        )}

        {/* ניווט טאבים */}
        <nav className="flex gap-1 mb-6 bg-slate-900/50 border border-slate-700/50 rounded-xl p-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-slate-800 text-white shadow-sm"
                    : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {/* תג התראות */}
                {tab.id === "alerts" && unreadAlerts > 0 && (
                  <span className="absolute -top-1 -left-1 w-4 h-4 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {unreadAlerts > 9 ? "9+" : unreadAlerts}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* תוכן טאב */}
        {loading ? (
          <LoadingSkeleton />
        ) : (
          <>
            {/* ── טאב: סקירה כללית ── */}
            {activeTab === "overview" && stats && (
              <div className="space-y-6">
                {/* KPI + ThreatScoreGauge */}
                <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <KpiCard
                    title="סה״כ חסימות"
                    value={stats.kpi.totalBlocked.toLocaleString("he-IL")}
                    icon={AlertTriangle}
                    color="rose"
                  />
                  <KpiCard
                    title="ציון פרטיות"
                    value={`${stats.kpi.privacyScore}%`}
                    icon={Shield}
                    color="violet"
                  />
                  <KpiCard
                    title="ישות מובילה"
                    value={stats.kpi.topEntity}
                    icon={Star}
                    color="amber"
                  />
                  <KpiCard
                    title="משתמשים פעילים"
                    value={stats.kpi.activeUsers}
                    icon={Users}
                    color="emerald"
                  />
                  <ThreatScoreGauge score={stats.kpi.avgThreatScore || 0} />
                </section>

                {/* גרפים */}
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <BlocksBarChart data={stats.dailyBlocks} />
                  <CategoryPieChart data={stats.categoryBreakdown} />
                </section>

                {/* חיפוש ופילטור */}
                <div className="flex flex-wrap gap-3 items-center">
                  <input
                    type="text"
                    placeholder="חיפוש בלוגים..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-4 py-2 focus:outline-none focus:ring-1 focus:ring-rose-500 min-w-[200px]"
                    dir="rtl"
                  />
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-rose-500"
                  >
                    {uniqueCategories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat === "all" ? "כל הקטגוריות" : cat}
                      </option>
                    ))}
                  </select>
                </div>

                {/* טבלת לוגים */}
                <section>
                  <LiveLogsTable
                    logs={stats.recentLogs}
                    searchQuery={searchQuery}
                    categoryFilter={categoryFilter}
                  />
                </section>
              </div>
            )}

            {/* ── טאב: מגמות ── */}
            {activeTab === "trends" && (
              <div className="space-y-6">
                <TrendLineChart
                  data={trendData?.trendData || []}
                  summary={trendData?.summary || {}}
                />
                {/* כרטיסי השוואה */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-5">
                    <p className="text-slate-400 text-sm mb-1">השבוע</p>
                    <p className="text-3xl font-bold text-white">
                      {trendData?.summary?.thisWeek ?? 0}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">חסימות</p>
                  </div>
                  <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-5">
                    <p className="text-slate-400 text-sm mb-1">שבוע שעבר</p>
                    <p className="text-3xl font-bold text-white">
                      {trendData?.summary?.lastWeek ?? 0}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">חסימות</p>
                  </div>
                  <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-5">
                    <p className="text-slate-400 text-sm mb-1">החודש</p>
                    <p className="text-3xl font-bold text-white">
                      {trendData?.summary?.thisMonth ?? 0}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">חסימות</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── טאב: התראות ── */}
            {activeTab === "alerts" && (
              <AlertsPanel />
            )}

            {/* ── טאב: משתמשים ── */}
            {activeTab === "users" && (
              <UsersTable />
            )}

            {/* ── טאב: GhostLayer Status ── */}
            {activeTab === "ghostlayer" && (
              <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6">
                <GhostLayerPanel health={health} />
              </div>
            )}

            {/* ── טאב: Knowledge Graph ── */}
            {activeTab === "knowledge" && (
              <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6">
                <KnowledgeGraphManager />
              </div>
            )}

            {/* ── טאב: בריאות מערכת ── */}
            {activeTab === "health" && (
              <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6">
                <SystemHealthMonitor health={health} />
              </div>
            )}

            {/* ── טאב: ניהול לקוחות ── */}
            {activeTab === "clients" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <Building2 className="w-5 h-5 text-blue-400" />
                    <h2 className="text-lg font-bold text-white">ניהול לקוחות</h2>
                    <span className="text-sm text-slate-400">({clients.length} לקוחות)</span>
                  </div>
                  <button
                    onClick={() => setShowWizard(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
                  >
                    <span>+ הוסף לקוח חדש</span>
                  </button>
                </div>

                {clientsLoading ? (
                  <div className="animate-pulse space-y-2">
                    {[...Array(3)].map((_, i) => <div key={i} className="bg-slate-800 h-14 rounded-xl" />)}
                  </div>
                ) : clients.length === 0 ? (
                  <div className="text-center py-16 text-slate-400">
                    <Building2 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p className="text-lg">אין לקוחות עדיין</p>
                    <p className="text-sm mt-1">לחץ על "הוסף לקוח חדש" כדי להתחיל</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-700/50">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-800/60 border-b border-slate-700/50">
                          <th className="text-right px-4 py-3 font-semibold text-slate-300">שם ארגון</th>
                          <th className="text-right px-4 py-3 font-semibold text-slate-300">מזהה</th>
                          <th className="text-right px-4 py-3 font-semibold text-slate-300">חבילה</th>
                          <th className="text-center px-4 py-3 font-semibold text-slate-300">חסימות</th>
                          <th className="text-center px-4 py-3 font-semibold text-slate-300">סטטוס</th>
                          <th className="text-center px-4 py-3 font-semibold text-slate-300">תאריך יצירה</th>
                          <th className="text-center px-4 py-3 font-semibold text-slate-300">פעולות</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clients.map((client) => (
                          <tr key={client.id} className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                            <td className="px-4 py-3 text-white font-medium">{client.name}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                <code className="text-xs text-slate-400 font-mono">{client.id.slice(0, 12)}…</code>
                                <button
                                  onClick={() => handleCopyKey(client.id)}
                                  className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
                                  title="העתק מזהה"
                                >
                                  {copiedKey === client.id ? "✓" : <span className="text-xs">📋</span>}
                                </button>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                                client.plan === "enterprise" ? "bg-violet-500/20 text-violet-300" :
                                client.plan === "pro"        ? "bg-blue-500/20 text-blue-300" :
                                                              "bg-slate-700 text-slate-300"
                              }`}>
                                {client.plan === "enterprise" ? "Enterprise" : client.plan === "pro" ? "מקצועי" : "בסיסי"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center text-slate-300">{client.stats?.totalBlocked || 0}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`text-xs px-2 py-1 rounded-full ${
                                client.status === "active"    ? "bg-green-500/20 text-green-400" :
                                client.status === "trial"     ? "bg-yellow-500/20 text-yellow-400" :
                                                               "bg-red-500/20 text-red-400"
                              }`}>
                                {client.status === "active" ? "פעיל" : client.status === "trial" ? "ניסיון" : "מושהה"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center text-slate-400 text-xs">
                              {new Date(client.createdAt).toLocaleDateString("he-IL")}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {client.id !== "default-org" && (
                                <button
                                  onClick={() => handleDeleteClient(client.id)}
                                  disabled={deletingClientId === client.id}
                                  className="text-rose-400 hover:text-rose-300 text-xs underline disabled:opacity-50 transition-colors"
                                >
                                  {deletingClientId === client.id ? "מוחק…" : "מחק"}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* אשף הוספת לקוח */}
                {showWizard && (
                  <ClientOnboardingWizard
                    onClose={() => setShowWizard(false)}
                    onClientCreated={() => fetchClients()}
                  />
                )}
              </div>
            )}

            {/* ── טאב: הגדרות ── */}
            {activeTab === "settings" && (
              <div className="space-y-6">
                <OrganizationSelector />
                <PolicySettings
                  policies={policies}
                  onToggle={handleTogglePolicy}
                />
              </div>
            )}

            {/* ── טאב: מילים מותאמות ── */}
            {activeTab === "keywords" && (
              <CustomKeywordsManager />
            )}
          </>
        )}
      </div>
    </main>
  );
}
