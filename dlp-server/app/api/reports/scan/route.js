import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectToDB } from "../../../../lib/mongodb.js";

// ── ScanReport Schema ──
const ScanReportSchema = new mongoose.Schema(
  {
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
    const apiKey = request.headers.get("x-api-key");
    if (!apiKey || apiKey !== process.env.DLP_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { totalFilesScanned, durationSeconds, timestamp } = body;

    if (totalFilesScanned == null || durationSeconds == null) {
      return NextResponse.json(
        { error: "totalFilesScanned and durationSeconds are required" },
        { status: 400 }
      );
    }

    await connectToDB();

    const report = await ScanReport.create({
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
