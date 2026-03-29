import { NextResponse } from "next/server";
import { getStats } from "@/lib/db";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function GET() {
  const stats = getStats();
  return NextResponse.json(stats, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
