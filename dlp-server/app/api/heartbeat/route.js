import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectToDB } from "../../../lib/mongodb.js";

export const dynamic = "force-dynamic";
// ── ClientHeartbeat Schema ──
const ClientHeartbeatSchema = new mongoose.Schema(
  {
    tenantId:          { type: String, required: true, index: true },
    licenseKey:        { type: String, required: true },
    activeAgentsCount: { type: Number, default: 0 },
    lastSeenAt:        { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const ClientHeartbeat =
  mongoose.models.ClientHeartbeat ||
  mongoose.model("ClientHeartbeat", ClientHeartbeatSchema);

// POST /api/heartbeat – local client servers call this every hour

export async function POST(request) {
  try {
    const body = await request.json();
    const { tenantId, licenseKey, activeAgentsCount } = body;

    if (!tenantId || !licenseKey) {
      return NextResponse.json(
        { error: "tenantId and licenseKey are required" },
        { status: 400 }
      );
    }

    await connectToDB();

    const record = await ClientHeartbeat.findOneAndUpdate(
      { tenantId },
      {
        $set: {
          licenseKey,
          activeAgentsCount: activeAgentsCount ?? 0,
          lastSeenAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    return NextResponse.json({
      status: "ok",
      tenantId: record.tenantId,
      lastSeenAt: record.lastSeenAt,
    });
  } catch (err) {
    console.error("[heartbeat] error:", err.message);
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
