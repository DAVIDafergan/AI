// POST /api/user-heartbeat – extension users ping every 10 minutes
// Allows the Admin Dashboard to display "Active Users" in real time.
// Only metadata is stored – no sensitive text is ever received here.
import { NextResponse } from "next/server";
import { connectMongo } from "../../../lib/db.js";
import mongoose from "mongoose";

export const dynamic = "force-dynamic";
// Active user window: a user is "active" if their last heartbeat is within
// this window. Set to 1.5× the 10-minute ping interval for a little slack.
const ACTIVE_USER_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// ── Schema ───────────────────────────────────────────────────────────────────
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

// Compound index so we can quickly find unique active users per org
UserHeartbeatSchema.index({ organizationId: 1, userEmail: 1 }, { unique: true });

const UserHeartbeat =
  mongoose.models.UserHeartbeat ||
  mongoose.model("UserHeartbeat", UserHeartbeatSchema);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Derive organizationId from the x-api-key header.
 *  Falls back to the header value itself so in-memory tenants work too. */
async function resolveOrgId(request) {
  const apiKey = request.headers.get("x-api-key") || "";
  if (!apiKey) throw Object.assign(new Error("x-api-key header is required"), { status: 401 });

  // Try MongoDB tenant lookup first
  try {
    const Tenant = mongoose.models.Tenant;
    if (Tenant) {
      // Import hashApiKey to compare against the stored SHA-256 digest
      const { hashApiKey } = await import("../../../lib/db.js");
      const tenant = await Tenant.findOne({ apiKey: hashApiKey(apiKey) }).lean();
      if (tenant) return String(tenant._id);
    }
  } catch {
    // MongoDB not available – fall through to in-memory store
  }

  // In-memory fallback (lib/db.js)
  try {
    const { getOrganizationByApiKey } = await import("../../../lib/db.js");
    const org = getOrganizationByApiKey?.(apiKey);
    if (org) return org.id;
  } catch {
    // lib/db may not export this helper – use the raw key as org id
  }

  return apiKey; // last resort – treat the key itself as org identifier
}

// ── POST handler ─────────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { userEmail, interceptedCount = 0, extensionVersion = "", timestamp } = body;

    if (!userEmail) {
      return NextResponse.json({ error: "userEmail is required" }, { status: 400 });
    }

    const organizationId = await resolveOrgId(request);

    await connectMongo();

    await UserHeartbeat.findOneAndUpdate(
      { organizationId, userEmail },
      {
        $set: {
          interceptedCount,
          extensionVersion,
          lastSeenAt: timestamp ? new Date(timestamp) : new Date(),
        },
      },
      { upsert: true, new: true }
    );

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    if (err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[user-heartbeat] error:", err.message);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// ── GET handler – return active users for the org ────────────────────────────
// "Active" = lastSeenAt within the last 15 minutes (1.5× the 10-min ping interval)

export async function GET(request) {
  try {
    const organizationId = await resolveOrgId(request);
    await connectMongo();

    const cutoff = new Date(Date.now() - ACTIVE_USER_WINDOW_MS);
    const users  = await UserHeartbeat.find(
      { organizationId, lastSeenAt: { $gte: cutoff } },
      { userEmail: 1, interceptedCount: 1, extensionVersion: 1, lastSeenAt: 1, _id: 0 }
    )
      .sort({ lastSeenAt: -1 })
      .lean();

    return NextResponse.json({ activeUsers: users, count: users.length });
  } catch (err) {
    if (err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[user-heartbeat] GET error:", err.message);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    },
  });
}
