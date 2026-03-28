"use client";

// גרף עוגה - התפלגות קטגוריות
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// טולטיפ מותאם לעיצוב כהה
function CustomTooltip({ active, payload }) {
  if (active && payload && payload.length) {
    const total = payload[0].payload.total;
    const percent = total ? ((payload[0].value / total) * 100).toFixed(1) : 0;
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 shadow-xl">
        <p className="text-slate-400 text-sm">{payload[0].name}</p>
        <p className="text-white font-bold">{payload[0].value} אירועים</p>
        <p className="text-slate-400 text-xs">{percent}% מהסך הכל</p>
      </div>
    );
  }
  return null;
}

// לג'נד מותאם בעברית
function CustomLegend({ payload }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 justify-center mt-2">
      {payload &&
        payload.map((entry, index) => (
          <li key={`legend-${index}`} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-slate-400 text-xs">{entry.value}</span>
          </li>
        ))}
    </ul>
  );
}

export default function CategoryPieChart({ data }) {
  // חישוב סך הכל להצגת אחוזים
  const total = data ? data.reduce((sum, item) => sum + item.value, 0) : 0;
  const dataWithTotal = data ? data.map((item) => ({ ...item, total })) : [];

  return (
    <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-6 shadow-lg">
      <h3 className="text-white font-semibold text-lg mb-6">התפלגות קטגוריות</h3>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={dataWithTotal}
            cx="50%"
            cy="45%"
            innerRadius={70}
            outerRadius={110}
            paddingAngle={3}
            dataKey="value"
          >
            {dataWithTotal.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend content={<CustomLegend />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
