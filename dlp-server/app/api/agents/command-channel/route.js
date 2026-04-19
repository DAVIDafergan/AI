import { NextResponse } from "next/server";
import { connectMongo, findTenantByApiKey, Agent } from "../../../../lib/db.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Global registry of connected agent SSE channels.
 * Key: agentKey (string), Value: { controller, encoder, tenantId, agentId, connectedAt }
 *
 * Uses globalThis so that the registry survives Next.js hot-reloads and is
 * shared across all route-handler invocations in the same Node.js process.
 */
const _g = globalThis;
if (!_g._agentChannels) _g._agentChannels = new Map();
const agentChannels = _g._agentChannels;

/** Returns the live channel map (used by sibling route handlers). */
export function getAgentChannels() {
  return agentChannels;
}

function sseChunk(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * GET /api/agents/command-channel
 *
 * Long-lived SSE connection opened by the on-premise GhostLayer agent.
 * The agent authenticates with its tenant API key in `x-api-key`.
 * Once registered, the server can push commands to the agent by writing to
 * the channel (see /api/agents/[id]/send-command).
 */
export async function GET(request) {
  try {
    await connectMongo();

    const apiKey = request.headers.get("x-api-key");
    if (!apiKey) {
      return NextResponse.json({ error: "Missing x-api-key header" }, { status: 401 });
    }

    const tenant = await findTenantByApiKey(apiKey);
    if (!tenant) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 403 });
    }
    if (tenant.status === "suspended") {
      return NextResponse.json({ error: "Tenant account is suspended" }, { status: 403 });
    }

    const agentKey = `local-${apiKey}`;
    const existingAgent = await Agent.findOne({ agentKey }, { _id: 1 }).lean();
    const agentId = existingAgent?._id?.toString() || agentKey;

    const encoder = new TextEncoder();
    let keepAliveTimer = null;

    const stream = new ReadableStream({
      start(controller) {
        agentChannels.set(agentKey, {
          controller,
          encoder,
          tenantId: tenant._id.toString(),
          agentKey,
          agentId,
          connectedAt: new Date(),
        });

        // Confirm connection to the agent
        controller.enqueue(
          encoder.encode(
            sseChunk("connected", {
              agentId,
              tenantId: tenant._id.toString(),
              serverTime: new Date().toISOString(),
            })
          )
        );

        // Send a keep-alive comment every 25 s so proxies don't close the connection
        keepAliveTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            // Stream is closed; stop the timer and clean up the channel entry
            clearInterval(keepAliveTimer);
            agentChannels.delete(agentKey);
          }
        }, 25_000);

        // Clean up when the agent disconnects
        request.signal.addEventListener("abort", () => {
          clearInterval(keepAliveTimer);
          agentChannels.delete(agentKey);
        });
      },
      cancel() {
        clearInterval(keepAliveTimer);
        agentChannels.delete(agentKey);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    },
  });
}
