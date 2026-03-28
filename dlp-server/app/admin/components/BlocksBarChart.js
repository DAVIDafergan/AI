"use client";

// גרף עמודות - חסימות לפי ימי השבוע
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// טולטיפ מותאם לעיצוב כהה
function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 shadow-xl">
        <p className="text-slate-400 text-sm">{label}</p>
        <p className="text-white font-bold text-lg">{payload[0].value} חסימות</p>
      </div>
    );
  }
  return null;
}

export default function BlocksBarChart({ data }) {
  return (
    <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-6 shadow-lg">
      <h3 className="text-white font-semibold text-lg mb-6">חסימות לפי ימים</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fill: "#94a3b8", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#94a3b8", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(148,163,184,0.05)" }} />
          <Bar dataKey="blocks" radius={[6, 6, 0, 0]}>
            {/* צבע גרדיאנט מ-rose ל-violet */}
            {data &&
              data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={`hsl(${330 + index * 10}, 80%, ${55 + index * 2}%)`}
                />
              ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
