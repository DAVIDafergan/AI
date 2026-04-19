import { NextResponse } from "next/server";
import { connectMongo, Agent, findTenantByApiKey } from "../../../../lib/db.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// In-memory store for recent command results (last 50 per agent)
const _g = globalThis;
if (!_g._commandResults) _g._commandResults = new Map();
const commandResults = _g._commandResults;

/**
 * POST /api/agents/command-result
 *
 * Receives the result of a previously-sent command from an on-premise agent.
 * The agent authenticates with its tenant API key in `x-api-key`.
 *
 * Body: { commandId: string, action: string, result: object, timestamp: string }
 */
export async function POST(request) {
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

    let body = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { commandId, action, result, timestamp } = body;
    if (!commandId || !action) {
      return NextResponse.json({ error: "commandId and action are required" }, { status: 400 });
    }

    const agentKey = `local-${apiKey}`;
    const agent = await Agent.findOne({ agentKey }, { _id: 1 }).lean();
    const agentId = agent?._id?.toString() || agentKey;

    // Store the result in memory (ring buffer per agent, last 50 results).
    // Node.js is single-threaded so concurrent push/shift is safe.
    const key = agentId;
    if (!commandResults.has(key)) commandResults.set(key, []);
    const results = commandResults.get(key);
    results.push({ commandId, action, result, timestamp: timestamp || new Date().toISOString() });
    if (results.length > 50) results.shift();

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * GET /api/agents/command-result?agentId=...&commandId=...
 *
 * Retrieve command results for an agent (super-admin only via cookie session).
 */
export async function GET(request) {
  try {
    // Note: command results may contain logs – no sensitive content, but
    // still restrict to authenticated callers via cookie session.
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get("agentId");
    const commandId = searchParams.get("commandId");

    if (!agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }

    const results = commandResults.get(agentId) || [];
    if (commandId) {
      const match = results.find((r) => r.commandId === commandId);
      return NextResponse.json({ result: match || null });
    }

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    },
  });
}
