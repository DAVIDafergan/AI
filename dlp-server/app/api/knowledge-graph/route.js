// ── Knowledge Graph API ──
// GET  /api/knowledge-graph?orgId=&query=&topK=5
// POST /api/knowledge-graph  { text, category, organizationId }
// DELETE /api/knowledge-graph?id=<entityId>

import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../lib/middleware.js";
import {
  addEntity,
  getEntity,
  deleteEntity,
  getEntitiesByOrg,
  searchSimilar,
  getKnowledgeGraphStats,
} from "../../../lib/knowledgeGraph.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

// GET – שאילתה / שליפת ישויות
export async function GET(request) {
  try {
    const auth = await authenticateRequest(request);
    const { organizationId } = auth;

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query");
    const topK = parseInt(searchParams.get("topK") || "5", 10);
    const threshold = parseFloat(searchParams.get("threshold") || "0.3");
    const entityId = searchParams.get("id");

    // שליפת ישות בודדת לפי ID
    if (entityId) {
      const entity = getEntity(entityId);
      if (!entity) {
        return NextResponse.json({ error: "Entity not found" }, { status: 404, headers: CORS_HEADERS });
      }
      return NextResponse.json({ entity }, { headers: CORS_HEADERS });
    }

    // חיפוש דמיון
    if (query) {
      const results = searchSimilar(query, organizationId, topK, threshold);
      return NextResponse.json(
        { results, query, topK, threshold },
        { headers: CORS_HEADERS }
      );
    }

    // שליפת כל הישויות + סטטיסטיקות
    const entities = getEntitiesByOrg(organizationId);
    const stats = getKnowledgeGraphStats(organizationId);

    return NextResponse.json({ entities, stats }, { headers: CORS_HEADERS });
  } catch (err) {
    if (err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
    }
    console.error("[knowledge-graph] GET error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: CORS_HEADERS });
  }
}

// POST – הוספת ישות חדשה
export async function POST(request) {
  try {
    const auth = await authenticateRequest(request);
    const { organizationId } = auth;

    const body = await request.json();
    const { text, category } = body;

    if (!text || typeof text !== "string" || text.trim().length < 2) {
      return NextResponse.json(
        { error: "text is required (min 2 chars)" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const entity = addEntity(text.trim(), category, organizationId);

    return NextResponse.json(
      { success: true, entity },
      { status: 201, headers: CORS_HEADERS }
    );
  } catch (err) {
    if (err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
    }
    console.error("[knowledge-graph] POST error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: CORS_HEADERS });
  }
}

// DELETE – מחיקת ישות
export async function DELETE(request) {
  try {
    const auth = await authenticateRequest(request);

    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get("id");

    if (!entityId) {
      return NextResponse.json(
        { error: "id param is required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const deleted = deleteEntity(entityId);
    if (!deleted) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404, headers: CORS_HEADERS });
    }

    return NextResponse.json({ success: true, deleted: entityId }, { headers: CORS_HEADERS });
  } catch (err) {
    if (err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
    }
    console.error("[knowledge-graph] DELETE error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    },
  });
}
