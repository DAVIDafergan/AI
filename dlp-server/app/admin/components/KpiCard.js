"use client";

// קומפוננט כרטיס KPI עם אפקט זוהר ואנימציה
export default function KpiCard({ title, value, icon: Icon, color, trend }) {
  const colorMap = {
    rose: {
      bg: "bg-rose-500/10",
      icon: "text-rose-500",
      shadow: "shadow-rose-500/20",
      trend: "bg-rose-500/20 text-rose-400",
    },
    violet: {
      bg: "bg-violet-500/10",
      icon: "text-violet-500",
      shadow: "shadow-violet-500/20",
      trend: "bg-violet-500/20 text-violet-400",
    },
    blue: {
      bg: "bg-blue-500/10",
      icon: "text-blue-500",
      shadow: "shadow-blue-500/20",
      trend: "bg-blue-500/20 text-blue-400",
    },
    emerald: {
      bg: "bg-emerald-500/10",
      icon: "text-emerald-500",
      shadow: "shadow-emerald-500/20",
      trend: "bg-emerald-500/20 text-emerald-400",
    },
    amber: {
      bg: "bg-amber-500/10",
      icon: "text-amber-500",
      shadow: "shadow-amber-500/20",
      trend: "bg-amber-500/20 text-amber-400",
    },
  };

  const c = colorMap[color] || colorMap.blue;

  return (
    <div
      className={`bg-slate-900 border border-slate-700/50 rounded-xl p-6 shadow-lg ${c.shadow} transition-all duration-300 hover:scale-[1.02] hover:shadow-xl`}
    >
      <div className="flex items-center justify-between mb-4">
        {/* אייקון עם רקע צבעוני */}
        <div className={`p-3 rounded-xl ${c.bg}`}>
          {Icon && <Icon className={`w-6 h-6 ${c.icon}`} />}
        </div>
        {/* תג מגמה אופציונלי */}
        {trend && (
          <span className={`text-xs font-medium px-2 py-1 rounded-full ${c.trend}`}>
            {trend}
          </span>
        )}
      </div>
      {/* ערך גדול */}
      <div className="text-3xl font-bold text-white mb-1">{value}</div>
      {/* כותרת */}
      <div className="text-sm text-slate-400">{title}</div>
    </div>
  );
}
