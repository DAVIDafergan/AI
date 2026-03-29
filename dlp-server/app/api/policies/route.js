import { NextResponse } from "next/server";
import { getPolicies, updatePolicy } from "@/lib/db";

export async function GET() {
  const policies = getPolicies();
  return NextResponse.json({ policies });
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, enabled } = body;

    if (!id || typeof enabled !== "boolean") {
      return NextResponse.json({ error: "id and enabled (boolean) are required" }, { status: 400 });
    }

    const updated = updatePolicy(id, enabled);
    if (!updated) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    return NextResponse.json({ policy: updated });
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
