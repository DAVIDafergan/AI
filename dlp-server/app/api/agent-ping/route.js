import { NextResponse } from "next/server";
import { connectMongo, Agent, TenantEvent } from "../../../lib/db.js";

// POST /api/agent-ping – heartbeat from agent with metrics
export async function POST(request) {
  try {
    await connectMongo();
    const body = await request.json();
    const { agentKey, metrics = {}, ip } = body;

    if (!agentKey) {
      return NextResponse.json({ error: "agentKey is required" }, { status: 400 });
    }

    const now = new Date();
    const metricsUpdate = {};
    const metricFields = ["documentsIndexed","vectorsStored","scansPerformed","blocksExecuted","avgResponseTime","uptime"];
    for (const field of metricFields) {
      if (metrics[field] !== undefined) metricsUpdate[`metrics.${field}`] = metrics[field];
    }
    if (metrics.lastScanAt) metricsUpdate["metrics.lastScanAt"] = new Date(metrics.lastScanAt);

    const agent = await Agent.findOneAndUpdate(
      { agentKey },
      { $set: { lastPing: now, lastPingIp: ip || null, ...metricsUpdate } },
      { new: true }
    ).lean();

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Determine syncStatus
    const diff = now - new Date(agent.lastPing || now);
    let syncStatus = "active";
    if (diff > 60000) syncStatus = "offline";
    else if ((agent.metrics?.documentsIndexed || 0) === 0) syncStatus = "learning";

    // Log connection event
    await TenantEvent.create({
      tenantId: agent.tenantId,
      agentId:  agent._id,
      eventType: "agent_connect",
      severity: "low",
      ip,
      details: { agentKey, metrics },
    });

    return NextResponse.json({
      status: "ok",
      syncStatus,
      config: agent.config,
      serverTime: now.toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
