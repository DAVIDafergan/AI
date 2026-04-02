import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongo, Tenant } from "../../../../lib/db.js";

// ── ScanReport Schema ──
const ScanReportSchema = new mongoose.Schema(
  {
    tenantId:          { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    totalFilesScanned: { type: Number, required: true },
    durationSeconds:   { type: Number, required: true },
    timestamp:         { type: Date,   required: true },
  },
  { timestamps: true }
);

const ScanReport =
  mongoose.models.ScanReport ||
  mongoose.model("ScanReport", ScanReportSchema);

// POST /api/reports/scan – local agent calls this after the file scanning phase
export async function POST(request) {
  try {
    await connectMongo();

    // ── Authentication ───────────────────────────────────────────────────────
    const apiKey = request.headers.get("x-api-key");
    if (!apiKey) {
      return NextResponse.json({ error: "Missing x-api-key header" }, { status: 401 });
    }

    const tenant = await Tenant.findOne({ apiKey }).lean();
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

    const { totalFilesScanned, durationSeconds, timestamp } = body;

    if (totalFilesScanned == null || durationSeconds == null) {
      return NextResponse.json(
        { error: "totalFilesScanned and durationSeconds are required" },
        { status: 400 }
      );
    }

    // ── Persist ──────────────────────────────────────────────────────────────
    const report = await ScanReport.create({
      tenantId: tenant._id,
      totalFilesScanned,
      durationSeconds,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    });

    return NextResponse.json(
      { message: "Scan report saved", id: report._id },
      { status: 200 }
    );
  } catch (err) {
    console.error("[reports/scan] error:", err.message);
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
