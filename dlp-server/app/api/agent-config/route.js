import { NextResponse } from "next/server";
import { connectMongo, Tenant } from "../../../lib/db.js";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function normalizeUrl(url) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

function resolveFallbackUrl(request) {
  const envUrl =
    process.env.DLP_SERVER_URL ||
    process.env.NEXT_PUBLIC_DLP_SERVER_URL ||
    process.env.NEXT_PUBLIC_SERVER_URL ||
    "";

  const normalizedEnv = normalizeUrl(envUrl);
  if (normalizedEnv) return normalizedEnv;

  try {
    const origin = new URL(request.url).origin;
    return normalizeUrl(origin) || "http://localhost:3000";
  } catch {
    return "http://localhost:3000";
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request) {
  const fallbackUrl = resolveFallbackUrl(request);

  try {
    await connectMongo();
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const tenantSlug = searchParams.get("tenantSlug");
    const apiKey = request.headers.get("x-api-key");

    let tenant = null;
    if (apiKey) {
      tenant = await Tenant.findOne({ apiKey }, { serverUrl: 1 }).lean();
    } else if (tenantId) {
      tenant = await Tenant.findById(tenantId, { serverUrl: 1 }).lean();
    } else if (tenantSlug) {
      tenant = await Tenant.findOne({ slug: tenantSlug }, { serverUrl: 1 }).lean();
    }

    const agentUrl = normalizeUrl(tenant?.serverUrl) || fallbackUrl;

    return NextResponse.json({ agentUrl }, { headers: CORS_HEADERS });
  } catch (err) {
    console.warn("[agent-config] Failed to resolve tenant agent URL, using fallback:", err?.message || err);
    return NextResponse.json({ agentUrl: fallbackUrl }, { headers: CORS_HEADERS });
  }
}
