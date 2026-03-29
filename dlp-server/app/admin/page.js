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
  { id: "overview",  label: "סקירה כללית", icon: BarChart3  },
  { id: "trends",    label: "מגמות",       icon: TrendingUp },
  { id: "alerts",    label: "התראות",      icon: Bell       },
  { id: "users",     label: "משתמשים",     icon: Users      },
  { id: "settings",  label: "הגדרות",      icon: Settings   },
  { id: "keywords",  label: "מילים מותאמות", icon: Tag      },
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

  // טעינה ראשונית
  useEffect(() => {
    fetchStats();
    fetchTrends();
    fetchAlertCount();
  }, [fetchStats, fetchTrends, fetchAlertCount]);

  // Auto-refresh כל 10 שניות
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStats();
      fetchAlertCount();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchStats, fetchAlertCount]);

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
