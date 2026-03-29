import { NextResponse } from "next/server";
import { getMappingBySynthetic } from "@/lib/db";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key, x-dlp-extension",
};

// ── POST: batch de-anonymization ──────────────────────────────────────────────
export async function POST(request) {
  try {
    const body = await request.json();
    const { tags } = body;

    if (!Array.isArray(tags) || tags.length === 0) {
      return NextResponse.json({ error: "tags array is required" }, { status: 400 }, { headers: CORS_HEADERS });
    }

    const results = {};
    for (const tag of tags) {
      const entry = getMappingBySynthetic(tag);
      if (entry) {
        results[tag] = {
          found: true,
          originalText: entry.original,
          category: entry.category,
          label: entry.label,
          timestamp: entry.timestamp,
        };
      } else {
        results[tag] = { found: false, originalText: tag };
      }
    }

    return NextResponse.json({ results }, { headers: CORS_HEADERS });
  } catch (err) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: CORS_HEADERS });
  }
}

// ── OPTIONS: preflight ────────────────────────────────────────────────────────
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
