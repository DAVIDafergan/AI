// API סטטיסטיקות – קורא נתונים אמיתיים מה-Store
import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../lib/middleware.js";
import { getStats, getLogs, getPolicies, savePolicies } from "../../../lib/db.js";
import { getDefaultPolicies } from "../../../lib/policies.js";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    },
  });
}

export async function GET(request) {
  try {
    const { organizationId } = await authenticateRequest(request);

    // חישוב KPI מנתונים אמיתיים
    const stats = getStats(organizationId);

    // לוגים אחרונים (עד 20)
    const recentLogsRaw = getLogs(organizationId, 20);
    const recentLogs = recentLogsRaw.map((log, idx) => ({
      id: idx + 1,
      timestamp: log.timestamp,
      type: log.type,
      placeholder: log.synthetic || `[${log.type}_${idx + 1}]`,
      source: log.source || "unknown",
      status: log.status || "blocked",
      threatScore: log.threatScore || 0,
    }));

    // מדיניות
    let orgPolicies = getPolicies(organizationId);
    if (!orgPolicies) {
      orgPolicies = getDefaultPolicies(organizationId);
      savePolicies(organizationId, orgPolicies);
    }

    return NextResponse.json(
      {
        kpi: stats.kpi,
        dailyBlocks: stats.dailyBlocks,
        categoryBreakdown: stats.categoryBreakdown,
        recentLogs,
        policySettings: orgPolicies,
        organizationId,
      },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, x-api-key",
        },
      }
    );
  } catch (err) {
    if (err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
