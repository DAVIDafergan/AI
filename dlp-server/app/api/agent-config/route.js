import { NextResponse } from "next/server";
import { connectMongo, Tenant, validateApiKey } from "../../../lib/db.js";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

function normalizeUrl(url) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

function trimApiKey(apiKey) {
  if (typeof apiKey !== "string") return "";
  return apiKey.trim();
}

async function resolveTenant({ rawApiKey, tenantId, tenantSlug }) {
  if (rawApiKey) {
    const validated = await validateApiKey(rawApiKey);
    if (!validated?.organizationId) return null;
    return Tenant.findById(validated.organizationId, { serverUrl: 1, settings: 1 }).lean();
  }
  if (tenantId) {
    return Tenant.findById(tenantId, { serverUrl: 1, settings: 1 }).lean();
  }
  if (tenantSlug) {
    return Tenant.findOne({ slug: tenantSlug }, { serverUrl: 1, settings: 1 }).lean();
  }
  return null;
}

function resolveApiKeyForResponse(tenant, rawApiKey) {
  const persistedKey = trimApiKey(tenant?.settings?.extensionApiKey);
  if (persistedKey) return persistedKey;
  return trimApiKey(rawApiKey);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request) {
  try {
    await connectMongo();
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const tenantSlug = searchParams.get("tenantSlug");
    const rawApiKey = trimApiKey(request.headers.get("x-api-key"));

    const tenant = await resolveTenant({ rawApiKey, tenantId, tenantSlug });

    const agentUrl = normalizeUrl(tenant?.serverUrl) || null;
    const apiKey = resolveApiKeyForResponse(tenant, rawApiKey);

    return NextResponse.json({ agentUrl, apiKey }, { headers: CORS_HEADERS });
  } catch (err) {
    console.warn("[agent-config] Failed to resolve tenant agent URL, using fallback:", err?.message || err);
    return NextResponse.json({ agentUrl: null, apiKey: "" }, { headers: CORS_HEADERS });
  }
}

async function upsertConfig(request) {
  try {
    await connectMongo();
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const tenantSlug = searchParams.get("tenantSlug");
    const rawApiKey = trimApiKey(request.headers.get("x-api-key"));

    const payload = await request.json().catch(() => ({}));
    const requestedAgentUrl = normalizeUrl(payload?.agentUrl);
    const requestedApiKey = trimApiKey(payload?.apiKey);

    if (!requestedAgentUrl && !requestedApiKey) {
      return NextResponse.json(
        { error: "agentUrl or apiKey is required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const tenant = await resolveTenant({ rawApiKey, tenantId, tenantSlug });
    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404, headers: CORS_HEADERS });
    }

    const update = {};
    if (requestedAgentUrl) {
      update.serverUrl = requestedAgentUrl;
    }
    if (requestedApiKey) {
      update["settings.extensionApiKey"] = requestedApiKey;
    }

    const updated = await Tenant.findByIdAndUpdate(
      tenant._id,
      { $set: update },
      { new: true, projection: { serverUrl: 1, settings: 1 } }
    ).lean();

    const responseAgentUrl = normalizeUrl(updated?.serverUrl) || null;
    const responseApiKey = resolveApiKeyForResponse(updated, rawApiKey);

    return NextResponse.json(
      { agentUrl: responseAgentUrl, apiKey: responseApiKey },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    console.warn("[agent-config] Failed to save tenant config:", err?.message || err);
    return NextResponse.json({ error: "Failed to save config" }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function POST(request) {
  return upsertConfig(request);
}

export async function PUT(request) {
  return upsertConfig(request);
}
