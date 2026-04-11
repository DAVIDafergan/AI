/**
 * GET /api/events/stream
 *
 * Server-Sent Events (SSE) endpoint for real-time dashboard updates.
 * Authenticated callers receive a continuous stream of system events:
 *   - "stats"   – aggregated platform KPIs (emitted every 10 s)
 *   - "event"   – individual TenantEvent records as they are created
 *   - "ping"    – keepalive every 25 s (prevents proxy timeouts)
 *
 * Authentication:
 *   Same as other super-admin endpoints: valid `super_admin_auth` cookie
 *   OR valid `x-super-admin-key` header.
 *
 * The stream uses standard text/event-stream format so it works with the
 * browser's native EventSource API and survives HTTP/2 multiplexing.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../../lib/superAdminAuth.js";
import { connectMongo, Tenant, Agent, TenantEvent } from "../../../../lib/db.js";

export const dynamic = "force-dynamic";
// How often (ms) to push a full stats snapshot to connected clients.
const STATS_INTERVAL_MS = 10_000;
// How often (ms) to emit a keepalive ping so proxies/load-balancers don't
// close the connection due to inactivity.
const PING_INTERVAL_MS  = 25_000;
// How long (ms) the stream stays open before the client must reconnect.
// Prevents unbounded resource accumulation on the server.
const MAX_STREAM_MS     = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch a fresh stats snapshot from MongoDB.
 * Returns null on error so the caller can skip that push.
 */
async function fetchStats() {
  try {
    await connectMongo();
    const now        = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const [totalTenants, activeTenants, totalAgents, allAgents, blocksToday] =
      await Promise.all([
        Tenant.countDocuments(),
        Tenant.countDocuments({ status: "active" }),
        Agent.countDocuments(),
        Agent.find({}, { lastPing: 1 }).lean(),
        TenantEvent.countDocuments({
          eventType: "block",
          timestamp:  { $gte: todayStart },
        }),
      ]);

    const onlineAgents = allAgents.filter((a) => {
      if (!a.lastPing) return false;
      return Date.now() - new Date(a.lastPing).getTime() < 60_000;
    }).length;

    return { totalTenants, activeTenants, totalAgents, onlineAgents, blocksToday };
  } catch {
    return null;
  }
}

/**
 * Fetch recent TenantEvents (last 60 s) to push incremental updates.
 * Returns [] on error.
 */
async function fetchRecentEvents() {
  try {
    await connectMongo();
    const since = new Date(Date.now() - 60_000);
    return await TenantEvent.find({ timestamp: { $gte: since } })
      .sort({ timestamp: -1 })
      .limit(20)
      .lean();
  } catch {
    return [];
  }
}

export async function GET(request) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  try {
    await requireSuperAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Build the SSE stream ────────────────────────────────────────────────────
  const encoder = new TextEncoder();

  /**
   * Format a named SSE event.
   * @param {string} eventName  e.g. "stats", "event", "ping"
   * @param {unknown} data      Will be JSON-serialised.
   */
  const sseEvent = (eventName, data) =>
    encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch {}
        clearInterval(statsTimer);
        clearInterval(pingTimer);
        clearTimeout(maxLifeTimer);
      };

      // ── Keepalive ping ─────────────────────────────────────────────────────
      const pingTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(sseEvent("ping", { ts: Date.now() }));
        } catch { close(); }
      }, PING_INTERVAL_MS);

      // ── Periodic stats snapshot ────────────────────────────────────────────
      const pushStats = async () => {
        if (closed) return;
        const stats = await fetchStats();
        if (!stats) return;
        try {
          controller.enqueue(sseEvent("stats", stats));
        } catch { close(); }
      };

      // Push stats immediately on connect, then on a timer.
      await pushStats();

      const statsTimer = setInterval(async () => {
        await pushStats();
        // Also push any new events alongside the stats tick.
        if (closed) return;
        const events = await fetchRecentEvents();
        if (events.length > 0) {
          try {
            controller.enqueue(sseEvent("events", events));
          } catch { close(); }
        }
      }, STATS_INTERVAL_MS);

      // ── Max stream lifetime ─────────────────────────────────────────────────
      const maxLifeTimer = setTimeout(close, MAX_STREAM_MS);

      // ── Abort on client disconnect ──────────────────────────────────────────
      request.signal?.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection:      "keep-alive",
      // Allow browser EventSource to reconnect automatically.

      "X-Accel-Buffering": "no",
    },
  });
}
