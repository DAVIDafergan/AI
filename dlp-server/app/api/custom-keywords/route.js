// API ניהול מילות מפתח מותאמות לארגון
import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../lib/middleware.js";
import { getCustomKeywords, saveCustomKeyword, deleteCustomKeyword } from "../../../lib/db.js";

// GET – קבלת כל מילות המפתח של הארגון
export async function GET(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    const keywords = getCustomKeywords(organizationId);
    return NextResponse.json({ keywords, organizationId });
  } catch (err) {
    if (err.status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST – הוספת מילת מפתח חדשה
export async function POST(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    const body = await request.json();
    const { word, category, replacement, severity } = body;
    if (!word || word.trim() === "") {
      return NextResponse.json({ error: "word is required" }, { status: 400 });
    }
    const saved = saveCustomKeyword(organizationId, {
      word: word.trim(),
      category: category || "CUSTOM",
      replacement: replacement || "",
      severity: severity || "medium",
    });
    return NextResponse.json({ success: true, keyword: saved }, { status: 201 });
  } catch (err) {
    if (err.status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// DELETE – מחיקת מילת מפתח לפי id
export async function DELETE(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const remaining = deleteCustomKeyword(organizationId, id);
    return NextResponse.json({ success: true, keywords: remaining });
  } catch (err) {
    if (err.status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
