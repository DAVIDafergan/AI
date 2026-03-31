// ── Health Check API ──
// GET /api/health – בדיקת תקינות מערכת

import { NextResponse } from "next/server";
import { getStats, getAllOrganizations } from "../../../lib/db.js";
import { getTriageStats } from "../../../lib/triage.js";
import { getKnowledgeGraphStats } from "../../../lib/knowledgeGraph.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

export async function GET() {
  const startTime = Date.now();

  try {
    // בדיקת רכיבי המערכת
    const checks = {};

    // בדיקת DB (In-Memory Store)
    try {
      const orgs = getAllOrganizations();
      checks.database = { status: "ok", organizations: orgs.length };
    } catch {
      checks.database = { status: "error", message: "DB check failed" };
    }

    // בדיקת Triage Engine
    try {
      const triageStats = getTriageStats();
      checks.triage = { status: "ok", stats: triageStats };
    } catch {
      checks.triage = { status: "error", message: "Triage check failed" };
    }

    // בדיקת Knowledge Graph
    try {
      const kgStats = getKnowledgeGraphStats();
      checks.knowledgeGraph = { status: "ok", stats: kgStats };
    } catch {
      checks.knowledgeGraph = { status: "error", message: "Knowledge Graph check failed" };
    }

    // בדיקת Stats
    try {
      const stats = getStats("default-org");
      checks.stats = { status: "ok", totalBlocked: stats?.kpi?.totalBlocked ?? 0 };
    } catch {
      checks.stats = { status: "error", message: "Stats check failed" };
    }

    const allOk = Object.values(checks).every((c) => c.status === "ok");
    const elapsed = Date.now() - startTime;

    return NextResponse.json(
      {
        status: allOk ? "ok" : "degraded",
        timestamp: new Date().toISOString(),
        version: "3.0.0",
        uptime: process.uptime ? Math.round(process.uptime()) : null,
        responseTime: `${elapsed}ms`,
        checks,
        environment: process.env.NODE_ENV || "development",
      },
      {
        status: allOk ? 200 : 207,
        headers: CORS_HEADERS,
      }
    );
  } catch (err) {
    console.error("[health] Error:", err);
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        responseTime: `${Date.now() - startTime}ms`,
        error: "Health check failed",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
