import { NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../lib/superAdminAuth.js";
import { connectMongo, Tenant, TenantEvent } from "../../../lib/db.js";

export const dynamic = "force-dynamic";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-super-admin-key",
};

// GET /api/tenant-events – list events with filters + pagination (super-admin only)
export async function GET(request) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();
    const { searchParams } = new URL(request.url);
    const tenantId  = searchParams.get("tenantId");
    const severity  = searchParams.get("severity");
    const eventType = searchParams.get("eventType");
    const page      = Math.max(1, parseInt(searchParams.get("page")  || "1"));
    const limit     = Math.min(100, parseInt(searchParams.get("limit") || "50"));

    const filter = {};
    if (tenantId)  filter.tenantId  = tenantId;
    if (severity)  filter.severity  = severity;
    if (eventType) filter.eventType = eventType;

    const [events, total] = await Promise.all([
      TenantEvent.find(filter).sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      TenantEvent.countDocuments(filter),
    ]);

    return NextResponse.json({ events, total, page, pages: Math.ceil(total / limit) }, { headers: CORS_HEADERS });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500, headers: CORS_HEADERS });
  }
}

// POST /api/tenant-events – create event
// Accepts either super-admin auth OR a valid tenantApiKey in the body (from local agents).
export async function POST(request) {
  try {
    await connectMongo();
    const body = await request.json();

    const {
      // Agent-originated event fields
      tenantApiKey,
      action,
      sensitivityLevel,
      matchedEntities,
      detectionTier,
      evasionTechniques,
      behaviorRiskScore,
      anomalyFlags,
      context: eventContext,
      // Super-admin / legacy fields
      tenantId: bodyTenantId,
      agentId,
      eventType: bodyEventType,
      severity: bodySeverity,
      category,
      details,
      userEmail,
      ip,
      timestamp,
    } = body;

    let resolvedTenantId;
    let resolvedEventType;
    let resolvedSeverity;
    let resolvedDetails;
    let resolvedWebhookUrl;

    if (tenantApiKey) {
      // ── Auth path: validate tenantApiKey and resolve tenant ──────────────
      const tenant = await Tenant.findOne({ apiKey: tenantApiKey }).lean();
      if (!tenant) {
        return NextResponse.json({ error: "Invalid tenantApiKey" }, { status: 401, headers: CORS_HEADERS });
      }
      resolvedTenantId   = tenant._id;
      resolvedWebhookUrl = tenant.settings?.webhookUrl || null;

      // Map agent action → TenantEvent schema
      resolvedEventType = action === "BLOCKED" || action === "BEHAVIOR_BLOCK" ? "block" : "scan";
      resolvedSeverity  = sensitivityLevel || "medium";
      resolvedDetails   = {
        matchedEntities:  matchedEntities  || [],
        detectionTier:    detectionTier    || "unknown",
        evasionTechniques: evasionTechniques || [],
        behaviorRiskScore: behaviorRiskScore || 0,
        anomalyFlags:     anomalyFlags      || [],
        context:          eventContext      || {},
        source:           "local-agent",
      };

      // Compute per-tenant expiry for GDPR/SOC2 data minimisation.
      // Falls back to 30 days if retentionDays is not configured.
      const retentionDays = tenant.settings?.retentionDays ?? 30;
      const eventTs       = timestamp ? new Date(timestamp) : new Date();
      resolvedExpireAt    = new Date(eventTs.getTime() + retentionDays * MS_PER_DAY);
    } else {
      // ── Auth path: require super-admin ───────────────────────────────────
      await requireSuperAdmin(request);
      if (!bodyTenantId || !bodyEventType) {
        return NextResponse.json({ error: "tenantId and eventType are required" }, { status: 400, headers: CORS_HEADERS });
      }
      resolvedTenantId  = bodyTenantId;
      resolvedEventType = bodyEventType;
      resolvedSeverity  = bodySeverity;
      resolvedDetails   = details;
      // Look up the webhookUrl for super-admin-created events too
      const tenantForWebhook = await Tenant.findById(bodyTenantId).select("settings.webhookUrl").lean();
      resolvedWebhookUrl = tenantForWebhook?.settings?.webhookUrl || null;
    }

    const event = await TenantEvent.create({
      tenantId:  resolvedTenantId,
      agentId,
      eventType: resolvedEventType,
      severity:  resolvedSeverity,
      category,
      details:   resolvedDetails,
      userEmail,
      ip,
      ...(timestamp      ? { timestamp: new Date(timestamp) } : {}),
      ...(resolvedExpireAt ? { expireAt: resolvedExpireAt }   : {}),
    });

    // Update tenant usage counters in a single operation

    const usageIncrement = resolvedEventType === "block"
      ? { "usage.totalBlocks": 1, "usage.totalScans": 1, "usage.monthlyScans": 1 }
      : { "usage.totalScans": 1, "usage.monthlyScans": 1 };

    await Tenant.findByIdAndUpdate(resolvedTenantId, {
      $inc: usageIncrement,
      $set: { "usage.lastActivity": new Date() },
    });

    // ── SIEM Webhook Forwarding ───────────────────────────────────────────────
    // Fire-and-forget: POST the event to the tenant's SIEM webhook (e.g. Splunk
    // HEC or Microsoft Sentinel). Failures are silently ignored so a broken SIEM
    // endpoint never disrupts the inbound event pipeline.
    if (resolvedWebhookUrl) {
      const siemPayload = JSON.stringify({
        source:    "ghostlayer-dlp",
        tenantId:  resolvedTenantId,
        eventId:   event._id,
        eventType: resolvedEventType,
        severity:  resolvedSeverity,
        category,
        details:   resolvedDetails,
        userEmail,
        ip,
        timestamp: event.timestamp,
      });
      fetch(resolvedWebhookUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    siemPayload,
        signal:  AbortSignal.timeout(10000),
      }).catch((err) => {
        // SIEM webhook failures are non-critical and must not disrupt the API,
        // but log a warning so operators can diagnose integration issues.
        console.warn(`[SIEM] Webhook delivery failed (${resolvedWebhookUrl}):`, err?.message || err);
      });
    }

    return NextResponse.json({ event }, { status: 201, headers: CORS_HEADERS });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500, headers: CORS_HEADERS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
