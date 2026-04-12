import { NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../../lib/superAdminAuth.js";
import { connectMongo, Tenant } from "../../../../lib/db.js";
import { recordAuditLog, getClientIp } from "../../../../lib/auditLog.js";

export const dynamic = "force-dynamic";
// GET /api/tenants/[id]
export async function GET(request, { params }) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();
    const tenant = await Tenant.findById(params.id).lean();
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    // Viewing the tenant record exposes the apiKey – treat as VIEW_API_KEY
    await recordAuditLog({
      tenantId:  params.id,
      actorId:   "super_admin",
      action:    "VIEW_API_KEY",
      resource:  `tenant:${params.id}`,
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ tenant });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

// PUT /api/tenants/[id]
export async function PUT(request, { params }) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();
    const body = await request.json();
    const tenant = await Tenant.findByIdAndUpdate(params.id, body, { new: true, runValidators: true }).lean();
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    await recordAuditLog({
      tenantId:  params.id,
      actorId:   "super_admin",
      action:    "UPDATE_TENANT",
      resource:  `tenant:${params.id}`,
      ipAddress: getClientIp(request),
      metadata:  { updatedFields: Object.keys(body) },
    });

    return NextResponse.json({ tenant });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

// DELETE /api/tenants/[id]

export async function DELETE(request, { params }) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();
    const tenant = await Tenant.findByIdAndDelete(params.id).lean();
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    await recordAuditLog({
      tenantId:  params.id,
      actorId:   "super_admin",
      action:    "DELETE_TENANT",
      resource:  `tenant:${params.id}`,
      ipAddress: getClientIp(request),
      metadata:  { name: tenant.name },
    });

    return NextResponse.json({ deleted: true, id: params.id });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-super-admin-key",
    },
  });
}
