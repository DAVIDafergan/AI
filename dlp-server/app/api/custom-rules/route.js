import { NextResponse } from "next/server";
import { getCustomRules, saveCustomRule, deleteCustomRule } from "@/lib/db";

export async function GET() {
  const rules = getCustomRules();
  return NextResponse.json({ rules });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { word, category = "CUSTOM", replacement } = body;

    if (!word || !word.trim()) {
      return NextResponse.json({ error: "word is required" }, { status: 400 });
    }

    const rule = saveCustomRule({ word: word.trim(), category, replacement: replacement?.trim() || word.trim() });
    return NextResponse.json({ rule }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const deleted = deleteCustomRule(id);
    if (!deleted) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
