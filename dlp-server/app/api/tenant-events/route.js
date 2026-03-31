import { NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../lib/superAdminAuth.js";
import { connectMongo, TenantEvent } from "../../../lib/db.js";

// GET /api/tenant-events – list events with filters + pagination
export async function GET(request) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();
    const { searchParams } = new URL(request.url);
    const tenantId  = searchParams.get("tenantId");
    const severity  = searchParams.get("severity");
    const eventType = searchParams.get("eventType");
    const page      = Math.max(1, parseInt(searchParams.get("page")  || "1"));
    const limit     = Math.min(100, parseInt(searchParams.get("limit") || "50"));

    const filter = {};
    if (tenantId)  filter.tenantId  = tenantId;
    if (severity)  filter.severity  = severity;
    if (eventType) filter.eventType = eventType;

    const [events, total] = await Promise.all([
      TenantEvent.find(filter).sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      TenantEvent.countDocuments(filter),
    ]);

    return NextResponse.json({ events, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

// POST /api/tenant-events – create event
export async function POST(request) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();
    const body = await request.json();
    const { tenantId, agentId, eventType, severity, category, details, userEmail, ip } = body;

    if (!tenantId || !eventType) {
      return NextResponse.json({ error: "tenantId and eventType are required" }, { status: 400 });
    }

    const event = await TenantEvent.create({
      tenantId, agentId, eventType, severity, category, details, userEmail, ip,
    });
    return NextResponse.json({ event }, { status: 201 });
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
