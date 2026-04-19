import { NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../lib/superAdminAuth.js";
import { connectMongo, Agent, Tenant } from "../../../lib/db.js";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";
// GET /api/agents – list agents (optionally filter by tenantId)
export async function GET(request) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const filter = tenantId ? { tenantId } : {};
    const agents = await Agent.find(filter).sort({ deployedAt: -1 }).lean();

    // Determine dynamic syncStatus based on lastPing
    const now = Date.now();
    const enriched = agents.map((a) => {
      let status = a.syncStatus;
      if (a.lastPing) {
        const diff = now - new Date(a.lastPing).getTime();
        if (diff > 60000) status = "offline";
        else if ((a.metrics?.documentsIndexed || 0) === 0) status = "learning";
        else status = "active";
      }
      return { ...a, syncStatus: status };
    });

    if (tenantId) {
      const tenant = await Tenant.findById(tenantId).select("remoteInstall agentUrl").lean();
      return NextResponse.json({ agents: enriched, remoteInstall: tenant?.remoteInstall || null });
    }

    return NextResponse.json({ agents: enriched });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

// POST /api/agents – create agent

export async function POST(request) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();
    const body = await request.json();
    const { tenantId, name, environment } = body;

    if (!tenantId || !name) {
      return NextResponse.json({ error: "tenantId and name are required" }, { status: 400 });
    }

    const agentKey = `agent-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const agent = await Agent.create({ tenantId, name, agentKey, environment });
    return NextResponse.json({ agent }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-super-admin-key",
    },
  });
}
