// API סטטיסטיקות – קורא נתונים אמיתיים מה-Store
import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../lib/middleware.js";
import {
  getStats,
  getLogs,
  getPolicies,
  savePolicies,
  getAllUsers,
  getUserStats,
  calculateRiskLevel,
  connectMongo,
  Tenant,
  TenantEvent,
} from "../../../lib/db.js";
import { getDefaultPolicies } from "../../../lib/policies.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view");

    // ── View: all users ──
    if (view === "users") {
      const allUsers = getAllUsers();
      return NextResponse.json({ users: allUsers }, { headers: CORS_HEADERS });
    }

    // ── View: single user ──
    if (view === "user") {
      const email = searchParams.get("email");
      if (!email) {
        return NextResponse.json({ error: "email param required" }, { status: 400, headers: CORS_HEADERS });
      }

      // Try MongoDB first when a tenant API key is provided
      const rawApiKey = request.headers.get("x-api-key");
      if (rawApiKey) {
        try {
          await connectMongo();
          const tenant = await Tenant.findOne({ apiKey: rawApiKey }).lean();
          if (tenant) {
            const tenantId = tenant._id;
            const [totalBlocks, catAgg, lastEvent] = await Promise.all([
              TenantEvent.countDocuments({ tenantId, eventType: "block", userEmail: email }),
              TenantEvent.aggregate([
                { $match: { tenantId, eventType: "block", userEmail: email } },
                { $group: { _id: "$category", count: { $sum: 1 } } },
              ]),
              TenantEvent.findOne({ tenantId, userEmail: email }).sort({ timestamp: -1 }).lean(),
            ]);
            const categoryBreakdown = {};
            for (const category of catAgg) {
              if (category._id) categoryBreakdown[category._id] = category.count;
            }
            const riskLevel = calculateRiskLevel({ totalBlocks, categoryBreakdown });
            return NextResponse.json({
              email,
              totalBlocks,
              categoryBreakdown,
              riskLevel,
              lastActivity: lastEvent?.timestamp || null,
            }, { headers: CORS_HEADERS });
          }
        } catch (mongoErr) {
          // Fall through to in-memory store
          console.warn("[stats] MongoDB user query failed:", mongoErr.message);
        }
      }

      const userStats = getUserStats(email);
      if (!userStats) {
        return NextResponse.json({ error: "User not found" }, { status: 404, headers: CORS_HEADERS });
      }
      return NextResponse.json(userStats, { headers: CORS_HEADERS });
    }

    // ── Default: org stats ──
    const stats = await getStats(organizationId);

    const recentLogsRaw = await getLogs(organizationId, 20);
    const recentLogs = recentLogsRaw.map((log, idx) => ({
      id: idx + 1,
      timestamp: log.timestamp,
      type: log.type,
      placeholder: log.synthetic || `[${log.type}_${idx + 1}]`,
      source: log.source || "unknown",
      status: log.status || "blocked",
      threatScore: log.threatScore || 0,
      userEmail: log.userEmail || "anonymous@unknown.com",
    }));

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
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    if (err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: CORS_HEADERS });
  }
}
