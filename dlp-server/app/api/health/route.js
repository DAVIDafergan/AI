// ── Health Check API ──
// GET /api/health – בדיקת תקינות מערכת

import { NextResponse } from "next/server";
import { getStats } from "../../../lib/db.js";
import { getTriageStats } from "../../../lib/triage.js";
import { getGraphStats } from "../../../lib/knowledgeGraph.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  const startTime = Date.now();

  try {
    // Check DB
    const dbStart = Date.now();
    const dbStats = await getStats(null);
    const dbLatency = Date.now() - dbStart;

    // Triage engine stats
    const triageStats = getTriageStats();

    // Knowledge graph stats
    const kgStats = getGraphStats();

    // Memory usage
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);

    const totalLatency = Date.now() - startTime;

    return NextResponse.json(
      {
        status: "healthy",
        version: "3.0.0",
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        latency: {
          total: totalLatency,
          db: dbLatency,
        },
        memory: {
          heapUsedMB: memMB,
          rss: Math.round(memUsage.rss / 1024 / 1024),
        },
        store: {
          totalBlocked: dbStats?.kpi?.totalBlocked || 0,
          activeUsers: dbStats?.kpi?.activeUsers || 0,
        },
        triage: triageStats,
        knowledgeGraph: kgStats,
        environment: process.env.NODE_ENV || "production",
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error("[health] error:", err);
    return NextResponse.json(
      {
        status: "degraded",
        error: err.message,
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: CORS_HEADERS }
    );
  }
}
