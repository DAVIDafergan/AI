"use client";

// דף ראשי של ה-Admin Dashboard
import { useState, useEffect } from "react";
import { Shield, AlertTriangle, Star, Users } from "lucide-react";
import KpiCard from "./components/KpiCard";
import BlocksBarChart from "./components/BlocksBarChart";
import CategoryPieChart from "./components/CategoryPieChart";
import LiveLogsTable from "./components/LiveLogsTable";
import PolicySettings from "./components/PolicySettings";
import ExportButton from "./components/ExportButton";

// מסך טעינה – שלד אנימטיבי
function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      {/* שלד כרטיסי KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-slate-900 border border-slate-700/50 rounded-xl h-32" />
        ))}
      </div>
      {/* שלד גרפים */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-700/50 rounded-xl h-80" />
        <div className="bg-slate-900 border border-slate-700/50 rounded-xl h-80" />
      </div>
      {/* שלד טבלה */}
      <div className="bg-slate-900 border border-slate-700/50 rounded-xl h-64" />
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [policies, setPolicies] = useState([]);

  // טעינת נתונים מה-API
  useEffect(() => {
    async function fetchStats() {
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
    }
    fetchStats();
  }, []);

  // עדכון מצב מדיניות
  function handleTogglePolicy(id) {
    setPolicies((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p))
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* כותרת עליונה */}
        <header className="flex items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-3">
            {/* לוגו */}
            <div className="p-2.5 bg-rose-500/10 rounded-xl">
              <Shield className="w-8 h-8 text-rose-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white leading-tight">DLP Shield</h1>
              <p className="text-slate-400 text-sm">Admin Dashboard</p>
            </div>
          </div>
          {/* כפתור ייצוא */}
          <ExportButton logs={stats?.recentLogs || []} />
        </header>

        {/* מצב שגיאה */}
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

              {/* כרטיסי KPI */}
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  title="סה״כ חסימות"
                  value={stats.kpi.totalBlocked.toLocaleString("he-IL")}
                  icon={AlertTriangle}
                  color="rose"
                  trend="+12%"
                />
                <KpiCard
                  title="ציון פרטיות"
                  value={`${stats.kpi.privacyScore}%`}
                  icon={Shield}
                  color="violet"
                  trend="+2.3%"
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
                  trend="+5"
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

            </div>
          )
        )}
      </div>
    </main>
  );
}
