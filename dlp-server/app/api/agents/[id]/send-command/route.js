import { NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../../../lib/superAdminAuth.js";
import { connectMongo, Agent } from "../../../../../lib/db.js";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const _g = globalThis;
if (!_g._agentChannels) _g._agentChannels = new Map();
const agentChannels = _g._agentChannels;

const ALLOWED_ACTIONS = ["scan", "get-logs", "deactivate", "update-config"];

function sseChunk(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * POST /api/agents/[id]/send-command
 *
 * Sends a real-time command to a connected on-premise agent via its SSE
 * command channel.  Requires super-admin authentication.
 *
 * Body: { action: "scan"|"get-logs"|"deactivate"|"update-config", params?: object }
 *
 * Response:
 *   { sent: true,  agentConnected: true,  commandId: "<uuid>" }
 *   { sent: false, agentConnected: false, message: "..." }
 */
export async function POST(request, { params }) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();

    const agent = await Agent.findById(params.id).lean();
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { action, params: cmdParams = {} } = body;

    if (!ALLOWED_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Allowed: ${ALLOWED_ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }

    const channel = agentChannels.get(agent.agentKey);
    if (!channel) {
      return NextResponse.json({
        sent: false,
        agentConnected: false,
        message: "Agent is not connected to the command channel",
      });
    }

    const commandId = randomUUID();
    const command = {
      commandId,
      action,
      params: cmdParams,
      timestamp: new Date().toISOString(),
    };

    try {
      channel.controller.enqueue(
        channel.encoder.encode(sseChunk("command", command))
      );
    } catch {
      // Channel was closed but not yet cleaned up
      agentChannels.delete(agent.agentKey);
      return NextResponse.json({
        sent: false,
        agentConnected: false,
        message: "Agent command channel is closed",
      });
    }

    return NextResponse.json({ sent: true, agentConnected: true, commandId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-super-admin-key",
    },
  });
}
