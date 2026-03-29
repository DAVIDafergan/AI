"use client";

// גרף מגמה – מציג חסימות ב-30 הימים האחרונים
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// פורמט תאריך לקצר
function fmtDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  } catch {
    return dateStr;
  }
}

export default function TrendLineChart({ data = [], summary = {} }) {
  // הצג רק כל 5 ימים בציר X
  const tickFormatter = (value, index) =>
    index % 5 === 0 ? fmtDate(value) : "";

  return (
    <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-6 shadow-lg">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-white font-semibold text-lg">מגמת חסימות – 30 ימים</h3>
        <div className="flex gap-4 text-sm">
          <div className="text-slate-400">
            השבוע:{" "}
            <span className="text-white font-semibold">{summary.thisWeek ?? 0}</span>
          </div>
          <div className="text-slate-400">
            שינוי:{" "}
            <span
              className={
                (summary.weekChange ?? 0) >= 0 ? "text-rose-400 font-semibold" : "text-emerald-400 font-semibold"
              }
            >
              {(summary.weekChange ?? 0) >= 0 ? "+" : ""}
              {summary.weekChange ?? 0}%
            </span>
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDate}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={{ stroke: "#475569" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={{ stroke: "#475569" }}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1e293b",
              border: "1px solid #475569",
              borderRadius: "8px",
              color: "#f1f5f9",
            }}
            labelFormatter={(label) => `תאריך: ${label}`}
            formatter={(value, name) => [value, name === "blocks" ? "חסימות" : "ציון איום"]}
          />
          <Legend
            formatter={(value) => (value === "blocks" ? "חסימות" : "ציון איום ממוצע")}
            wrapperStyle={{ color: "#94a3b8", fontSize: 12 }}
          />
          <Line
            type="monotone"
            dataKey="blocks"
            stroke="#f43f5e"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, fill: "#f43f5e" }}
          />
          <Line
            type="monotone"
            dataKey="avgThreatScore"
            stroke="#8b5cf6"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, fill: "#8b5cf6" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
