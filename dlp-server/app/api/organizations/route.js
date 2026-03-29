// API ניהול ארגונים (Multi-tenancy)
import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../lib/middleware.js";
import { getOrganization, createOrganization, updateOrganization, getAllOrganizations } from "../../../lib/db.js";

// GET – קבלת פרטי ארגון
export async function GET(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    const org = getOrganization(organizationId);
    if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    return NextResponse.json({ organization: org });
  } catch (err) {
    if (err.status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST – יצירת ארגון חדש
export async function POST(request) {
  try {
    // לפעולה זו לא נדרש אימות (רישום עצמאי)
    const body = await request.json();
    const { name, id } = body;
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const org = createOrganization({ name, id });
    return NextResponse.json({ success: true, organization: org }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// PUT – עדכון הגדרות ארגון
export async function PUT(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    const updates = await request.json();
    const updated = updateOrganization(organizationId, updates);
    if (!updated) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    return NextResponse.json({ success: true, organization: updated });
  } catch (err) {
    if (err.status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
