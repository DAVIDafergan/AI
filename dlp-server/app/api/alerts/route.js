// API ניהול התראות אבטחה
import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../lib/middleware.js";
import { getAlerts, markAlertRead } from "../../../lib/db.js";

// GET – קבלת כל ההתראות (חדשות ראשונות)
export async function GET(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    const orgAlerts = getAlerts(organizationId);
    const unreadCount = orgAlerts.filter((a) => !a.read).length;
    return NextResponse.json({ alerts: orgAlerts, unreadCount, organizationId });
  } catch (err) {
    if (err.status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST – סימון התראה כנקראה
export async function POST(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    const { alertId } = await request.json();
    if (!alertId) return NextResponse.json({ error: "alertId is required" }, { status: 400 });
    const updated = markAlertRead(alertId);
    if (!updated) return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    if (updated.organizationId !== organizationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    return NextResponse.json({ success: true, alert: updated });
  } catch (err) {
    if (err.status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
