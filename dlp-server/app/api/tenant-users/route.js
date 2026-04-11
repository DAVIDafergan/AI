/**
 * GET /api/tenant-users?tenantId=<id>
 *
 * Returns active extension users for a specific tenant.
 * Requires x-super-admin-key authentication.
 *
 * "Active" = sent a heartbeat within the last 15 minutes.
 */
import { NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../lib/superAdminAuth.js";
import { connectMongo, Tenant } from "../../../lib/db.js";
import { connectToDB } from "../../../lib/mongodb.js";
import mongoose from "mongoose";

export const dynamic = "force-dynamic";
const ACTIVE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// ── UserHeartbeat model (mirrors user-heartbeat/route.js schema) ──────────────
const UserHeartbeatSchema = new mongoose.Schema(
  {
    organizationId:   { type: String, required: true, index: true },
    userEmail:        { type: String, required: true },
    interceptedCount: { type: Number, default: 0 },
    extensionVersion: { type: String, default: "" },
    lastSeenAt:       { type: Date,   default: Date.now, index: true },
  },
  { timestamps: true }
);
UserHeartbeatSchema.index({ organizationId: 1, userEmail: 1 }, { unique: true });

const UserHeartbeat =
  mongoose.models.UserHeartbeat ||
  mongoose.model("UserHeartbeat", UserHeartbeatSchema);

export async function GET(request) {
  try {
    await requireSuperAdmin(request);

    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
    }

    await connectMongo();

    // Resolve the tenant's MongoDB _id string → organisationId used in heartbeats
    const tenant = await Tenant.findById(tenantId).lean();
    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // The user-heartbeat endpoint stores organizationId = String(tenant._id)

    const organizationId = String(tenant._id);

    const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS);
    const users  = await UserHeartbeat.find(
      { organizationId, lastSeenAt: { $gte: cutoff } },
      { userEmail: 1, interceptedCount: 1, extensionVersion: 1, lastSeenAt: 1, _id: 0 }
    )
      .sort({ lastSeenAt: -1 })
      .lean();

    return NextResponse.json({ users, count: users.length });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-super-admin-key",
    },
  });
}
