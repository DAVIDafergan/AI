"use client";

// מד ציון איום – מד גרפי עם צבעים דינמיים (0-100)

function getColor(score) {
  if (score < 30) return { text: "text-emerald-400", bg: "bg-emerald-500", label: "נמוך", ring: "ring-emerald-500" };
  if (score < 60) return { text: "text-yellow-400", bg: "bg-yellow-500", label: "בינוני", ring: "ring-yellow-500" };
  if (score < 80) return { text: "text-orange-400", bg: "bg-orange-500", label: "גבוה", ring: "ring-orange-500" };
  return { text: "text-rose-400", bg: "bg-rose-500", label: "קריטי", ring: "ring-rose-500" };
}

export default function ThreatScoreGauge({ score = 0, title = "ציון איום ממוצע" }) {
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const { text, bg, label } = getColor(clampedScore);
  const pct = clampedScore;

  // SVG arc gauge
  const radius = 60;
  const circumference = Math.PI * radius; // חצי עיגול
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  return (
    <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-6 shadow-lg flex flex-col items-center">
      <h3 className="text-white font-semibold text-lg mb-4">{title}</h3>

      {/* SVG Gauge */}
      <div className="relative w-40 h-24 mb-4">
        <svg viewBox="0 0 160 90" className="w-full h-full">
          {/* רקע */}
          <path
            d="M 10 80 A 70 70 0 0 1 150 80"
            fill="none"
            stroke="#1e293b"
            strokeWidth="14"
            strokeLinecap="round"
          />
          {/* ציון */}
          <path
            d="M 10 80 A 70 70 0 0 1 150 80"
            fill="none"
            stroke={pct < 30 ? "#10b981" : pct < 60 ? "#eab308" : pct < 80 ? "#f97316" : "#f43f5e"}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * 220} 220`}
            className="transition-all duration-700"
          />
        </svg>
        {/* ספרה במרכז */}
        <div className="absolute inset-0 flex items-end justify-center pb-1">
          <span className={`text-3xl font-bold ${text}`}>{clampedScore}</span>
        </div>
      </div>

      <span className={`text-sm font-semibold px-3 py-1 rounded-full ${text} bg-slate-800`}>
        {label}
      </span>

      {/* סרגל הדרגתי */}
      <div className="w-full mt-4 h-2 rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${bg}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between w-full text-xs text-slate-500 mt-1">
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </div>
    </div>
  );
}
