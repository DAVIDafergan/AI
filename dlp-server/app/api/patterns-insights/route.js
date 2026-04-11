import { NextResponse } from "next/server";
import { getPatternStats, getLogs } from "@/lib/db";

export async function GET() {
  const patternStats = getPatternStats();

  // peak hours: group logs by hour
  const logs = await getLogs(null, 1000);
  const hourCounts = Array(24).fill(0);
  for (const log of logs) {
    if (log.timestamp) {
      const h = new Date(log.timestamp).getHours();
      hourCounts[h]++;
    }
  }
  const peakHours = hourCounts
    .map((count, hour) => ({ hour, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // categories by day of week
  const dayCategories = {};
  const dayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  for (const log of logs) {
    if (log.timestamp) {
      const day = dayNames[new Date(log.timestamp).getDay()];
      if (!dayCategories[day]) dayCategories[day] = {};
      const cat = log.type || log.category || "אחר";
      dayCategories[day][cat] = (dayCategories[day][cat] || 0) + 1;
    }
  }

  const categoriesByDay = Object.entries(dayCategories).map(([day, cats]) => ({
    day,
    topCategory: Object.entries(cats).sort((a, b) => b[1] - a[1])[0]?.[0] || "—",
    breakdown: cats,
  }));

  return NextResponse.json({
    patternStats,
    peakHours,
    categoriesByDay,
    totalPatterns: patternStats.reduce((s, p) => s + p.count, 0),
  });
}
