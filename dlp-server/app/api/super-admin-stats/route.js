import { NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../lib/superAdminAuth.js";
import { connectMongo, Tenant, Agent, TenantEvent } from "../../../lib/db.js";

export const dynamic = "force-dynamic";
// GET /api/super-admin-stats – aggregated platform statistics
export async function GET(request) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const weekStart  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalTenants,
      activeTenants,
      totalAgents,
      allAgents,
      blocksToday,
      blocksWeek,
      blocksMonth,
      topTenants,
      blocksByCategory,
      hourlyRaw,
      recentCritical,
    ] = await Promise.all([
      Tenant.countDocuments(),
      Tenant.countDocuments({ status: "active" }),
      Agent.countDocuments(),
      Agent.find({}, { lastPing: 1, metrics: 1 }).lean(),
      TenantEvent.countDocuments({ eventType: "block", timestamp: { $gte: todayStart } }),
      TenantEvent.countDocuments({ eventType: "block", timestamp: { $gte: weekStart } }),
      TenantEvent.countDocuments({ eventType: "block", timestamp: { $gte: monthStart } }),

      // Top tenants by blocks
      TenantEvent.aggregate([
        { $match: { eventType: "block" } },
        { $group: { _id: "$tenantId", blocks: { $sum: 1 } } },
        { $sort: { blocks: -1 } },
        { $limit: 5 },
        { $lookup: { from: "tenants", localField: "_id", foreignField: "_id", as: "tenant" } },
        { $unwind: { path: "$tenant", preserveNullAndEmptyArrays: true } },
        { $project: { tenantId: "$_id", name: "$tenant.name", blocks: 1, _id: 0 } },
      ]),

      // Blocks by category
      TenantEvent.aggregate([
        { $match: { eventType: "block" } },
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { category: "$_id", count: 1, _id: 0 } },
      ]),

      // Hourly trend last 24h
      TenantEvent.aggregate([
        { $match: { eventType: "block", timestamp: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } } },
        {
          $group: {
            _id: { $hour: "$timestamp" },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { hour: "$_id", count: 1, _id: 0 } },
      ]),

      // Recent critical events
      TenantEvent.find({ severity: "critical" })
        .sort({ timestamp: -1 })
        .limit(10)
        .lean(),
    ]);

    // Online agents: last ping within 60s
    const onlineAgents = allAgents.filter((a) => {
      if (!a.lastPing) return false;
      return Date.now() - new Date(a.lastPing).getTime() < 60000;
    }).length;

    // System health: based on online ratio

    const healthPct = totalAgents > 0 ? Math.round((onlineAgents / totalAgents) * 100) : 100;
    const systemHealth = healthPct >= 80 ? "healthy" : healthPct >= 50 ? "degraded" : "critical";

    return NextResponse.json({
      totalTenants,
      activeTenants,
      totalAgents,
      onlineAgents,
      blocksToday,
      blocksWeek,
      blocksMonth,
      topTenants,
      blocksByCategory,
      hourlyTrend: hourlyRaw,
      systemHealth: { status: systemHealth, score: healthPct },
      recentCriticalEvents: recentCritical,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-super-admin-key",
    },
  });
}
