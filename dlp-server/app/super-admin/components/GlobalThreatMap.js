"use client";

import { BarChart2 } from "lucide-react";

function SimpleBarChart({ data, labelKey = "name", valueKey = "count", color = "#22d3ee" }) {
  const max = Math.max(...data.map((d) => d[valueKey] || 0), 1);
  return (
    <div className="space-y-1.5">
      {data.map((item, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-28 truncate text-slate-400 text-right">{item[labelKey] || "—"}</span>
          <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(item[valueKey] / max) * 100}%`, backgroundColor: color }}
            />
          </div>
          <span className="w-8 text-right font-mono text-slate-300">{item[valueKey]}</span>
        </div>
      ))}
    </div>
  );
}

function HourlyChart({ data }) {
  const hours = Array.from({ length: 24 }, (_, h) => {
    const found = data.find((d) => d.hour === h);
    return { hour: h, count: found?.count || 0 };
  });
  const max = Math.max(...hours.map((h) => h.count), 1);

  return (
    <div className="flex items-end gap-0.5 h-16">
      {hours.map((h) => (
        <div
          key={h.hour}
          title={`${h.hour}:00 — ${h.count} חסימות`}
          className="flex-1 rounded-t transition-all duration-500"
          style={{
            height: `${Math.max(4, (h.count / max) * 100)}%`,
            backgroundColor: h.count > 0 ? "#f43f5e" : "#1e293b",
          }}
        />
      ))}
    </div>
  );
}

function PieChart({ data }) {
  if (!data || data.length === 0) return <p className="text-xs text-slate-600 text-center py-4">אין נתונים</p>;
  const total = data.reduce((s, d) => s + d.count, 0) || 1;
  const COLORS = ["#22d3ee", "#a855f7", "#f43f5e", "#f97316", "#22c55e", "#3b82f6", "#ec4899", "#84cc16"];

  let angle = 0;
  const slices = data.slice(0, 6).map((d, i) => {
    const pct = d.count / total;
    const startAngle = angle;
    angle += pct * 360;
    return { ...d, pct, startAngle, endAngle: angle, color: COLORS[i % COLORS.length] };
  });

  const polarToCartesian = (cx, cy, r, angleDeg) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const cx = 60, cy = 60, r = 50;

  return (
    <div className="flex items-center gap-4">
      <svg width={120} height={120} viewBox="0 0 120 120">
        {slices.map((s, i) => {
          const start = polarToCartesian(cx, cy, r, s.startAngle);
          const end   = polarToCartesian(cx, cy, r, s.endAngle);
          const large = s.endAngle - s.startAngle > 180 ? 1 : 0;
          return (
            <path
              key={i}
              d={`M${cx},${cy} L${start.x},${start.y} A${r},${r},0,${large},1,${end.x},${end.y} Z`}
              fill={s.color}
              opacity={0.85}
            />
          );
        })}
        <circle cx={cx} cy={cy} r={28} fill="#0d0d14" />
      </svg>
      <div className="space-y-1">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <span className="truncate max-w-[80px]">{s.category || "—"}</span>
            <span className="text-slate-500 font-mono">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GlobalThreatMap({ stats }) {
  const topTenants    = stats?.topTenants || [];
  const byCategory    = stats?.blocksByCategory || [];
  const hourlyTrend   = stats?.hourlyTrend || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Bar chart – top tenants */}
      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={14} className="text-cyan-400" />
          <span className="text-xs text-slate-400 uppercase tracking-wider">חסימות לפי דייר (7 ימים)</span>
        </div>
        {topTenants.length === 0
          ? <p className="text-xs text-slate-600 text-center py-4">אין נתונים</p>
          : <SimpleBarChart data={topTenants} labelKey="name" valueKey="blocks" />
        }
      </div>

      {/* Hourly line chart */}
      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={14} className="text-red-400" />
          <span className="text-xs text-slate-400 uppercase tracking-wider">חסימות לפי שעה (24 שעות)</span>
        </div>
        <HourlyChart data={hourlyTrend} />
        <div className="flex justify-between text-xs text-slate-600 mt-1">
          <span>00:00</span>
          <span>12:00</span>
          <span>23:00</span>
        </div>
      </div>

      {/* Category pie */}
      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={14} className="text-purple-400" />
          <span className="text-xs text-slate-400 uppercase tracking-wider">חסימות לפי קטגוריה</span>
        </div>
        <PieChart data={byCategory} />
      </div>
    </div>
  );
}
