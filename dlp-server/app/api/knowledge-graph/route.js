// ── Knowledge Graph API ──
// POST  /api/knowledge-graph  – הוספת ישות רגישה חדשה
// GET   /api/knowledge-graph  – חיפוש ישויות דומות (query param: q)
// DELETE /api/knowledge-graph – מחיקת ישות (query param: id)

import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../lib/middleware.js";
import {
  addEntity,
  removeEntity,
  getAllEntities,
  searchSimilar,
  getGraphStats,
} from "../../../lib/knowledgeGraph.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ── POST: הוספת ישות חדשה ──
export async function POST(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    const body = await request.json();
    const { text, category } = body;

    if (!text || !category) {
      return NextResponse.json(
        { error: "text and category are required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const entity = addEntity({ text, category, organizationId });
    return NextResponse.json({ success: true, entity }, { headers: CORS_HEADERS });
  } catch (err) {
    if (err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
    }
    console.error("[knowledge-graph] POST error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: CORS_HEADERS });
  }
}

// ── GET: חיפוש ישויות דומות / רשימת כל הישויות ──
export async function GET(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");
    const stats = searchParams.get("stats");

    if (stats === "true") {
      return NextResponse.json(getGraphStats(), { headers: CORS_HEADERS });
    }

    if (query) {
      const topK = parseInt(searchParams.get("topK") || "5", 10);
      const threshold = parseFloat(searchParams.get("threshold") || "0.1");
      const results = searchSimilar(query, { topK, threshold, organizationId });
      return NextResponse.json({ results }, { headers: CORS_HEADERS });
    }

    const entities = getAllEntities(organizationId);
    return NextResponse.json({ entities }, { headers: CORS_HEADERS });
  } catch (err) {
    if (err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: CORS_HEADERS });
  }
}

// ── DELETE: מחיקת ישות ──
export async function DELETE(request) {
  try {
    await authenticateRequest(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "id param is required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const removed = removeEntity(id);
    if (!removed) {
      return NextResponse.json(
        { error: "Entity not found" },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
  } catch (err) {
    if (err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: CORS_HEADERS });
  }
}
