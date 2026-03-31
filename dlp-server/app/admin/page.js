"use client";

// דף ראשי של ה-Admin Dashboard – CISO Enterprise Dashboard
import { useState, useEffect, useCallback } from "react";
import { Shield, AlertTriangle, Star, Users, TrendingUp, Bell, Settings, Tag, BarChart3, Gauge } from "lucide-react";
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

// הגדרות טאבים
const TABS = [
  { id: "overview",     label: "סקירה כללית",   icon: BarChart3  },
  { id: "trends",       label: "מגמות",          icon: TrendingUp },
  { id: "alerts",       label: "התראות",          icon: Bell       },
  { id: "users",        label: "משתמשים",        icon: Users      },
  { id: "ghostlayer",   label: "GhostLayer",     icon: Gauge      },
  { id: "settings",     label: "הגדרות",          icon: Settings   },
  { id: "keywords",     label: "מילים מותאמות",  icon: Tag        },
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
  const [healthData, setHealthData] = useState(null);
  const [kgEntities, setKgEntities] = useState([]);
  const [kgQuery, setKgQuery] = useState("");
  const [kgResults, setKgResults] = useState([]);
  const [kgNewText, setKgNewText] = useState("");
  const [kgNewCategory, setKgNewCategory] = useState("UNKNOWN");

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

  // טעינת נתוני בריאות מערכת (כולל Triage Stats)
  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) return;
      const data = await res.json();
      setHealthData(data);
    } catch {
      // שגיאת רשת
    }
  }, []);

  // טעינת Knowledge Graph Entities
  const fetchKGEntities = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge-graph");
      if (!res.ok) return;
      const data = await res.json();
      setKgEntities(data.entities || []);
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
    fetchKGEntities();
  }, [fetchStats, fetchTrends, fetchAlertCount, fetchHealth, fetchKGEntities]);

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

  // Knowledge Graph: חיפוש דמיון
  async function handleKGSearch(e) {
    e.preventDefault();
    if (!kgQuery.trim()) return;
    try {
      const res = await fetch(`/api/knowledge-graph?query=${encodeURIComponent(kgQuery)}&topK=5`);
      if (!res.ok) return;
      const data = await res.json();
      setKgResults(data.results || []);
    } catch { /* ignore */ }
  }

  // Knowledge Graph: הוספת ישות חדשה
  async function handleKGAdd(e) {
    e.preventDefault();
    if (!kgNewText.trim()) return;
    try {
      await fetch("/api/knowledge-graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: kgNewText, category: kgNewCategory }),
      });
      setKgNewText("");
      fetchKGEntities();
    } catch { /* ignore */ }
  }

  // Knowledge Graph: מחיקת ישות
  async function handleKGDelete(id) {
    try {
      await fetch(`/api/knowledge-graph?id=${id}`, { method: "DELETE" });
      fetchKGEntities();
    } catch { /* ignore */ }
  }

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
              <div className="space-y-6">
                {/* Triage Stats */}
                <section className="bg-slate-900 border border-slate-700/50 rounded-xl p-6">
                  <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <Gauge className="w-5 h-5 text-violet-400" />
                    GhostLayer Triage Engine – אחוזי הצלחה
                  </h2>
                  {healthData?.checks?.triage ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {[
                        { label: "L1 – Fast Scan", rate: healthData.checks.triage.stats?.l1Rate || "0%", hits: healthData.checks.triage.stats?.l1Hits || 0, borderClass: "border-emerald-500/30", textClass: "text-emerald-400", desc: "Regex + Bloom Filter (< 1ms)" },
                        { label: "L2 – Semantic Hash", rate: healthData.checks.triage.stats?.l2Rate || "0%", hits: healthData.checks.triage.stats?.l2Hits || 0, borderClass: "border-amber-500/30", textClass: "text-amber-400", desc: "Hash Signatures (< 10ms)" },
                        { label: "L3 – Hebrew NLP", rate: healthData.checks.triage.stats?.l3Rate || "0%", hits: healthData.checks.triage.stats?.l3Hits || 0, borderClass: "border-rose-500/30", textClass: "text-rose-400", desc: "Context Inference (< 150ms)" },
                      ].map((tier) => (
                        <div key={tier.label} className={`bg-slate-800 border rounded-xl p-5 ${tier.borderClass}`}>
                          <p className={`text-xs font-medium uppercase tracking-wide mb-1 ${tier.textClass}`}>{tier.label}</p>
                          <p className="text-3xl font-bold text-white">{tier.rate}</p>
                          <p className="text-slate-400 text-xs mt-1">{tier.hits} זיהויים</p>
                          <p className="text-slate-500 text-xs mt-0.5">{tier.desc}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-400 text-sm">טוען נתוני Triage...</p>
                  )}
                  {healthData && (
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div className="bg-slate-800 rounded-lg p-3">
                        <p className="text-slate-400 text-xs">סה״כ בדיקות</p>
                        <p className="text-white font-semibold">{healthData.checks?.triage?.stats?.total || 0}</p>
                      </div>
                      <div className="bg-slate-800 rounded-lg p-3">
                        <p className="text-slate-400 text-xs">ניקיים</p>
                        <p className="text-emerald-400 font-semibold">{healthData.checks?.triage?.stats?.clean || 0}</p>
                      </div>
                      <div className="bg-slate-800 rounded-lg p-3">
                        <p className="text-slate-400 text-xs">סטטוס</p>
                        <p className={`font-semibold ${healthData.status === "ok" ? "text-emerald-400" : "text-amber-400"}`}>{healthData.status === "ok" ? "תקין" : "מוזהר"}</p>
                      </div>
                      <div className="bg-slate-800 rounded-lg p-3">
                        <p className="text-slate-400 text-xs">זמן תגובה</p>
                        <p className="text-white font-semibold">{healthData.responseTime || "—"}</p>
                      </div>
                    </div>
                  )}
                </section>

                {/* Knowledge Graph Manager */}
                <section className="bg-slate-900 border border-slate-700/50 rounded-xl p-6">
                  <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <Star className="w-5 h-5 text-amber-400" />
                    Knowledge Graph – ניהול ישויות רגישות
                  </h2>

                  {/* הוספת ישות */}
                  <form onSubmit={handleKGAdd} className="flex flex-wrap gap-3 mb-5">
                    <input
                      type="text"
                      placeholder="טקסט ישות רגישה חדשה..."
                      value={kgNewText}
                      onChange={(e) => setKgNewText(e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-4 py-2 flex-1 min-w-[200px] focus:outline-none focus:ring-1 focus:ring-violet-500"
                      dir="rtl"
                    />
                    <select
                      value={kgNewCategory}
                      onChange={(e) => setKgNewCategory(e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    >
                      {["UNKNOWN","PASSWORD","CREDIT_CARD","ID","EMAIL","PHONE","ADDRESS","API_SECRET","BANK_ACCOUNT"].map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <button type="submit" className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
                      הוסף ישות
                    </button>
                  </form>

                  {/* חיפוש דמיון */}
                  <form onSubmit={handleKGSearch} className="flex gap-3 mb-5">
                    <input
                      type="text"
                      placeholder="חיפוש דמיון קשרי..."
                      value={kgQuery}
                      onChange={(e) => setKgQuery(e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-4 py-2 flex-1 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      dir="rtl"
                    />
                    <button type="submit" className="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
                      חפש
                    </button>
                  </form>

                  {/* תוצאות חיפוש */}
                  {kgResults.length > 0 && (
                    <div className="mb-5">
                      <p className="text-slate-400 text-xs mb-2">תוצאות חיפוש ({kgResults.length})</p>
                      <div className="space-y-2">
                        {kgResults.map((r) => (
                          <div key={r.id} className="bg-slate-800 rounded-lg p-3 flex justify-between items-center">
                            <div>
                              <p className="text-white text-sm">{r.text}</p>
                              <p className="text-slate-400 text-xs">{r.category} • דמיון: {(r.similarityScore * 100).toFixed(1)}%</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* רשימת ישויות */}
                  <div>
                    <p className="text-slate-400 text-xs mb-2">ישויות רשומות ({kgEntities.length})</p>
                    {kgEntities.length === 0 ? (
                      <p className="text-slate-500 text-sm">אין ישויות עדיין. הוסף ישויות רגישות ידועות.</p>
                    ) : (
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {kgEntities.map((entity) => (
                          <div key={entity.id} className="bg-slate-800 rounded-lg p-3 flex justify-between items-center">
                            <div>
                              <p className="text-white text-sm">{entity.text}</p>
                              <p className="text-slate-400 text-xs">{entity.category}</p>
                            </div>
                            <button
                              onClick={() => handleKGDelete(entity.id)}
                              className="text-rose-400 hover:text-rose-300 text-xs px-2 py-1 rounded transition-colors"
                            >
                              מחק
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
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
