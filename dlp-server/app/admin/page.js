"use client";

// דף ראשי של ה-Admin Dashboard
import { useState, useEffect, useCallback } from "react";
import { Shield, AlertTriangle, Star, Users, TrendingUp, RefreshCw } from "lucide-react";
import KpiCard from "./components/KpiCard";
import BlocksBarChart from "./components/BlocksBarChart";
import CategoryPieChart from "./components/CategoryPieChart";
import LiveLogsTable from "./components/LiveLogsTable";
import PolicySettings from "./components/PolicySettings";
import ExportButton from "./components/ExportButton";
import CustomRulesManager from "./components/CustomRulesManager";
import AlertsPanel from "./components/AlertsPanel";

const REFRESH_INTERVAL = 10000; // 10 seconds

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

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = useCallback(async (silent = false) => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("שגיאה בטעינת הנתונים");
      const data = await res.json();
      setStats(data);
      setPolicies(data.policySettings || []);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => fetchStats(true), REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchStats]);

  function handleTogglePolicy(id) {
    setPolicies(prev =>
      prev.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p)
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* כותרת עליונה */}
        <header className="flex items-center justify-between mb-8 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-500/10 rounded-xl">
              <Shield className="w-8 h-8 text-rose-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white leading-tight">DLP Shield</h1>
              <div className="flex items-center gap-2">
                <p className="text-slate-400 text-sm">Admin Dashboard</p>
                {lastUpdated && (
                  <span className="text-slate-600 text-xs">
                    · עודכן {lastUpdated.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchStats(false)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg text-sm transition-colors disabled:opacity-50"
              title="רענן נתונים"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              רענן
            </button>
            <ExportButton logs={stats?.recentLogs || []} />
          </div>
        </header>

        {/* הודעת שגיאה */}
        {error && (
          <div className="bg-rose-900/30 border border-rose-500/50 rounded-xl p-4 mb-6 text-rose-400 text-sm">
            {error}
          </div>
        )}

        {/* מצב טעינה */}
        {loading ? (
          <LoadingSkeleton />
        ) : (
          stats && (
            <div className="space-y-6">

              {/* התראות */}
              <section>
                <AlertsPanel />
              </section>

              {/* כרטיסי KPI */}
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
                  value={stats.kpi.topEntity || "—"}
                  icon={Star}
                  color="amber"
                />
                <KpiCard
                  title="ממוצע סיכון"
                  value={`${stats.kpi.avgThreatScore ?? 0}`}
                  icon={TrendingUp}
                  color="rose"
                />
                <KpiCard
                  title="משתמשים פעילים"
                  value={stats.kpi.activeUsers}
                  icon={Users}
                  color="emerald"
                />
              </section>

              {/* גרפים */}
              <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <BlocksBarChart data={stats.dailyBlocks} />
                <CategoryPieChart data={stats.categoryBreakdown} />
              </section>

              {/* טבלת לוגים */}
              <section>
                <LiveLogsTable logs={stats.recentLogs} />
              </section>

              {/* הגדרות מדיניות */}
              <section>
                <PolicySettings
                  policies={policies}
                  onToggle={handleTogglePolicy}
                />
              </section>

              {/* ניהול כללים מותאמים */}
              <section>
                <CustomRulesManager />
              </section>

            </div>
          )
        )}
      </div>
    </main>
  );
}
