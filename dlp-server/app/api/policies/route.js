// API ניהול מדיניות DLP לפי ארגון
import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../lib/middleware.js";
import { getPolicies, savePolicies } from "../../../lib/db.js";
import { getDefaultPolicies } from "../../../lib/policies.js";

// GET – החזרת כל המדיניות לארגון
export async function GET(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    let orgPolicies = getPolicies(organizationId);
    if (!orgPolicies) {
      orgPolicies = getDefaultPolicies(organizationId);
      savePolicies(organizationId, orgPolicies);
    }
    return NextResponse.json({ policies: orgPolicies, organizationId });
  } catch (err) {
    if (err.status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// PUT – עדכון מדיניות קיימת (הפעלה/כיבוי, שינוי חומרה)
export async function PUT(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    const body = await request.json();
    const { id, enabled, severity } = body;
    if (!id) return NextResponse.json({ error: "Policy id is required" }, { status: 400 });

    let orgPolicies = getPolicies(organizationId) || getDefaultPolicies(organizationId);
    const updated = orgPolicies.map((p) => {
      if (p.id !== id) return p;
      return {
        ...p,
        ...(enabled !== undefined && { enabled }),
        ...(severity !== undefined && { severity }),
      };
    });
    savePolicies(organizationId, updated);
    return NextResponse.json({ success: true, policies: updated });
  } catch (err) {
    if (err.status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST – יצירת מדיניות מותאמת חדשה
export async function POST(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    const body = await request.json();
    const { id, label, description, enabled = true, category = "CUSTOM", severity = "medium" } = body;
    if (!id || !label) return NextResponse.json({ error: "id and label are required" }, { status: 400 });

    let orgPolicies = getPolicies(organizationId) || getDefaultPolicies(organizationId);
    if (orgPolicies.find((p) => p.id === id)) {
      return NextResponse.json({ error: "Policy id already exists" }, { status: 409 });
    }
    const newPolicy = { id, label, description: description || "", enabled, category, severity, organizationId };
    orgPolicies.push(newPolicy);
    savePolicies(organizationId, orgPolicies);
    return NextResponse.json({ success: true, policy: newPolicy }, { status: 201 });
  } catch (err) {
    if (err.status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
