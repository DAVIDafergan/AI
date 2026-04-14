import { NextResponse } from "next/server";
import { connectMongo, Tenant, Agent, TenantEvent, hashApiKey } from "../../../../lib/db.js";

export const dynamic = "force-dynamic";
/**
 * POST /api/agents/heartbeat
 *
 * Receives a heartbeat from the GhostLayer On-Premise Agent.
 * The agent authenticates with the tenant's API key sent in the
 * `x-api-key` header.
 *
 * Expected body:
 *   {
 *     status:              "Active",
 *     filesScanned:        <integer>,
 *     sensitiveTermsFound: <integer>,
 *     agentVersion?:       string,
 *     timestamp?:          ISO-8601 string,
 *   }
 *
 * IMPORTANT: The endpoint deliberately does NOT accept or store any
 * sensitive terms/content – only the metadata counts are persisted.
 */
export async function POST(request) {
  try {
    await connectMongo();

    // ── Authentication ───────────────────────────────────────────────────────
    const apiKey = request.headers.get("x-api-key");
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing x-api-key header" },
        { status: 401 }
      );
    }

    const tenant = await Tenant.findOne({ apiKey: hashApiKey(apiKey) }).lean();
    if (!tenant) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 403 });
    }

    if (tenant.status === "suspended") {
      return NextResponse.json({ error: "Tenant account is suspended" }, { status: 403 });
    }

    // ── Parse body ───────────────────────────────────────────────────────────
    let body = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const {
      status        = "Active",
      filesScanned  = 0,
      sensitiveTermsFound = 0,
      agentVersion  = "unknown",
    } = body;

    // Basic validation
    if (typeof filesScanned !== "number" || typeof sensitiveTermsFound !== "number") {
      return NextResponse.json(
        { error: "filesScanned and sensitiveTermsFound must be numbers" },
        { status: 400 }
      );
    }

    const now = new Date();
    const ip  = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
                request.headers.get("x-real-ip") || null;

    // ── Upsert agent record ──────────────────────────────────────────────────
    // Use the tenant's apiKey as the agentKey so the on-premise agent has a
    // stable identifier without requiring a separate registration step.
    const agentKey = `local-${apiKey}`;

    const agent = await Agent.findOneAndUpdate(
      { agentKey },
      {
        $set: {
          tenantId:    tenant._id,
          name:        `On-Premise Agent (${tenant.name})`,
          syncStatus:  "active",
          lastPing:    now,
          lastPingIp:  ip,
          version:     agentVersion,
          environment: "production",
          // documentsIndexed reflects the size of the latest scan (not cumulative)
          "metrics.documentsIndexed": filesScanned,
          "metrics.lastScanAt":      now,
        },
        $inc: {
          // scansPerformed is a cumulative count of completed scan operations
          "metrics.scansPerformed": 1,
        },
      },
      { upsert: true, new: true }
    ).lean();

    // ── Update tenant usage ──────────────────────────────────────────────────
    await Tenant.updateOne(
      { _id: tenant._id },
      {
        // Increment by 1 to count completed scan operations
        $inc: { "usage.totalScans": 1 },
        $set: { "usage.lastActivity": now },
      }
    );

    // ── Audit log ────────────────────────────────────────────────────────────
    await TenantEvent.create({
      tenantId:  tenant._id,
      agentId:   agent._id,
      eventType: "agent_connect",
      severity:  "low",
      ip,
      details: {
        source:              "on-premise-agent",
        agentVersion,
        status,
        filesScanned,
        sensitiveTermsFound,
        // NOTE: No sensitive content is stored here, only the count.

      },
    });

    return NextResponse.json({
      ok:        true,
      message:   "Heartbeat received",
      tenantId:  tenant._id,
      agentId:   agent._id,
      serverTime: now.toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    },
  });
}
