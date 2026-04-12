import { NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../lib/superAdminAuth.js";
import { connectMongo, Tenant, Agent } from "../../../lib/db.js";
import { recordAuditLog, getClientIp } from "../../../lib/auditLog.js";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";
// POST /api/provision – create agent + return deployment config

export async function POST(request) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();
    const body = await request.json();
    const { tenantId, name, environment = "production" } = body;

    if (!tenantId || !name) {
      return NextResponse.json({ error: "tenantId and name are required" }, { status: 400 });
    }

    const tenant = await Tenant.findById(tenantId).lean();
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    const agentKey = `agent-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const agent = await Agent.create({ tenantId, name, agentKey, environment });

    const serverUrl = process.env.DLP_SERVER_URL || "https://ai-production-ffa9.up.railway.app";

    const envConfig = [
      `DLP_SERVER_URL=${serverUrl}`,
      // Replace the placeholder with the raw API key from the POST /api/tenants response
      // (credentials.apiKey).  The database stores only a keyed hash and cannot recover it.
      `DLP_TENANT_API_KEY=REPLACE_WITH_RAW_API_KEY_FROM_TENANT_CREATION`,
      `DLP_AGENT_KEY=${agentKey}`,
      `DLP_ENVIRONMENT=${environment}`,
      `DLP_PING_INTERVAL=30000`,
    ].join("\n");

    const dockerCommand = [
      "docker run -d \\",
      `  --name ghostlayer-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")} \\`,
      `  -e DLP_SERVER_URL=${serverUrl} \\`,
      `  -e DLP_TENANT_API_KEY=REPLACE_WITH_RAW_API_KEY_FROM_TENANT_CREATION \\`,
      `  -e DLP_AGENT_KEY=${agentKey} \\`,
      `  -e DLP_ENVIRONMENT=${environment} \\`,
      "  ghostlayer/agent:latest",
    ].join("\n");

    await recordAuditLog({
      tenantId:  tenantId,
      actorId:   "super_admin",
      action:    "PROVISION_AGENT",
      resource:  `agent:${agent._id}`,
      ipAddress: getClientIp(request),
      metadata:  { agentName: name, environment },
    });

    return NextResponse.json({
      agent,
      deploymentConfig: { envConfig, dockerCommand },
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

export async function OPTIONS() {
  // OPTIONS preflight is handled centrally by middleware.js.
  return new NextResponse(null, { status: 204 });
}
