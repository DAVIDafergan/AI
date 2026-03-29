import { NextResponse } from "next/server";
import { getAlerts, markAlertRead } from "@/lib/db";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get("unread") === "true";
  const alerts = getAlerts({ unreadOnly });
  return NextResponse.json({ alerts });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const alert = markAlertRead(Number(id));
    if (!alert) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    return NextResponse.json({ alert });
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
