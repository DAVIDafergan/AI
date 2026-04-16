import { NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../lib/superAdminAuth.js";
import { connectMongo, Tenant, Agent, hashApiKey } from "../../../lib/db.js";
import { recordAuditLog, getClientIp } from "../../../lib/auditLog.js";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";
const AGENT_ONLINE_THRESHOLD_MS = 60000;
const normalizeUrl = (value) => {
  if (typeof value !== "string") return "";
  let normalized = value.trim();
  while (normalized.length > 0 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized;
};

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// GET /api/tenants – list all tenants enriched with agent counts
export async function GET(request) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();
    const tenants = await Tenant.find({}).sort({ createdAt: -1 }).lean();

    // Enrich each tenant with agentCount and onlineAgentCount
    const now = Date.now();
    const agentsByTenant = await Agent.find(
      { tenantId: { $in: tenants.map((t) => t._id) } },
      { tenantId: 1, lastPing: 1 }
    ).lean();

    const countMap = {};
    const onlineMap = {};
    for (const a of agentsByTenant) {
      const key = String(a.tenantId);
      countMap[key] = (countMap[key] || 0) + 1;
      const isOnline = a.lastPing && now - new Date(a.lastPing).getTime() < AGENT_ONLINE_THRESHOLD_MS;
      if (isOnline) onlineMap[key] = (onlineMap[key] || 0) + 1;
    }

    const enriched = tenants.map((t) => {
      const key = String(t._id);
      return { ...t, agentCount: countMap[key] || 0, onlineAgentCount: onlineMap[key] || 0 };
    });

    return NextResponse.json({ tenants: enriched });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

// POST /api/tenants – create tenant
export async function POST(request) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();
    const body = await request.json();
    const { name, contactEmail, contactName, plan, domain, serverUrl, agentUrl } = body;

    if (!name || !contactEmail) {
      return NextResponse.json({ error: "name and contactEmail are required" }, { status: 400 });
    }

    const rawApiKey = randomUUID();
    const { randomBytes } = await import("crypto");
    const apiSecret = randomBytes(32).toString("hex");
    const slug = slugify(name) || `tenant-${randomUUID()}`;

    const tenant = await Tenant.create({
      name,
      slug,
      apiKey: hashApiKey(rawApiKey),
      apiSecret,
      contactEmail,
      contactName,
      plan: plan || "starter",
      domain,
      serverUrl: normalizeUrl(serverUrl),
      agentUrl: normalizeUrl(agentUrl),
    });

    await recordAuditLog({
      tenantId:  tenant._id,
      actorId:   "super_admin",
      action:    "CREATE_TENANT",
      resource:  `tenant:${tenant._id}`,
      ipAddress: getClientIp(request),
      metadata:  { name, plan: plan || "starter" },
    });

    // Return the raw API key only once – the caller must store it securely.
    // The database stores only its HMAC-SHA256 keyed hash; the raw key cannot be recovered.
    return NextResponse.json({
      tenant,
      credentials: { apiKey: rawApiKey, apiSecret },
    }, { status: 201 });
  } catch (err) {
    if (err.code === 11000) {
      return NextResponse.json({ error: "Tenant name or slug already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

export async function OPTIONS() {
  // OPTIONS preflight is handled centrally by middleware.js.
  return new NextResponse(null, { status: 204 });
}
