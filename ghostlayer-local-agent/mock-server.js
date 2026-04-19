#!/usr/bin/env node
/**
 * mock-server.js – Local mock of the GhostLayer SaaS backend for development
 * and testing.
 *
 * Simulates every server-side endpoint that the local agent calls:
 *
 *   POST /api/agents/heartbeat        – receives periodic telemetry
 *   POST /api/tenant-events           – receives DLP block events
 *   POST /api/reports/scan            – receives scan summary reports
 *   GET  /api/agents/command-channel  – SSE stream for remote commands
 *   POST /api/agents/command-result   – receives command execution results
 *   POST /api/agents/send-command     – (test helper) push a command to the
 *                                       agent via the SSE stream
 *
 * Usage:
 *   node mock-server.js [--port 3333] [--verbose]
 *
 * Then point the agent at this server:
 *   node index.js --api-key=test-key --dir=./sample-docs \
 *                 --saas-url=http://localhost:3333 --verbose
 *
 * Or with the API server:
 *   SERVER_URL=http://localhost:3333 API_KEY=test-key node api-server.js
 */

import http from "node:http";
import { parseArgs } from "node:util";

// ── CLI arguments ─────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    port:    { type: "string",  short: "p", default: "3333" },
    verbose: { type: "boolean", short: "v", default: false  },
  },
  strict: false,
});

const PORT    = Number(args.port) || 3333;
const VERBOSE = args.verbose;

// ── SSE connection registry ───────────────────────────────────────────────────
// Maps agentId → { res, apiKey }

const sseClients = new Map();
let   nextAgentId = 1;

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(tag, ...msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${tag}`, ...msg);
}

function verbose(tag, ...msg) {
  if (VERBOSE) log(tag, ...msg);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end",  ()  => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type":  "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function sseWrite(res, eventName, data) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  res.write(`event: ${eventName}\ndata: ${payload}\n\n`);
}

// ── Request router ────────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const path   = url.pathname;
  const method = req.method.toUpperCase();

  // ── POST /api/agents/heartbeat ─────────────────────────────────────────────
  if (method === "POST" && path === "/api/agents/heartbeat") {
    const body = await readBody(req);
    log("💓 HEARTBEAT", JSON.stringify(body, null, 2));
    sendJson(res, 200, { ok: true, message: "heartbeat received" });
    return;
  }

  // ── POST /api/tenant-events ────────────────────────────────────────────────
  if (method === "POST" && path === "/api/tenant-events") {
    const body = await readBody(req);
    log("🚨 DLP EVENT", JSON.stringify(body, null, 2));
    sendJson(res, 200, { ok: true });
    return;
  }

  // ── POST /api/reports/scan ─────────────────────────────────────────────────
  if (method === "POST" && path === "/api/reports/scan") {
    const body = await readBody(req);
    log("📊 SCAN REPORT", JSON.stringify(body, null, 2));
    sendJson(res, 200, { ok: true, reportId: `mock-${Date.now()}` });
    return;
  }

  // ── GET /api/agents/command-channel (SSE) ──────────────────────────────────
  if (method === "GET" && path === "/api/agents/command-channel") {
    const apiKey  = req.headers["x-api-key"] || "unknown";
    const agentId = `mock-agent-${nextAgentId++}`;

    res.writeHead(200, {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    });

    // Register this client
    sseClients.set(agentId, { res, apiKey });
    log(`🔌 COMMAND CHANNEL connected – agentId: ${agentId}  key: ${apiKey}`);

    // Send the initial "connected" event
    sseWrite(res, "connected", { agentId, message: "Connected to mock command channel" });

    // Send a keep-alive comment every 30 s so the connection stays open
    const keepAlive = setInterval(() => {
      if (!res.destroyed) {
        res.write(": keep-alive\n\n");
      }
    }, 30_000);

    req.on("close", () => {
      clearInterval(keepAlive);
      sseClients.delete(agentId);
      log(`🔌 COMMAND CHANNEL disconnected – agentId: ${agentId}`);
    });

    return; // keep the connection open – do NOT call res.end()
  }

  // ── POST /api/agents/command-result ────────────────────────────────────────
  if (method === "POST" && path === "/api/agents/command-result") {
    const body = await readBody(req);
    log("✅ COMMAND RESULT", JSON.stringify(body, null, 2));
    sendJson(res, 200, { ok: true });
    return;
  }

  // ── POST /api/agents/send-command ──────────────────────────────────────────
  // Test helper: push a remote command to a connected agent via SSE.
  //
  // Body: { "agentId": "mock-agent-1", "action": "scan" }
  //   or: { "action": "scan" }  (broadcasts to all connected agents)
  //
  // Supported actions: scan | get-logs | deactivate | update-config
  if (method === "POST" && path === "/api/agents/send-command") {
    const body      = await readBody(req);
    const { action, params = {}, agentId: targetId } = body;

    if (!action) {
      sendJson(res, 400, { error: "Missing required field: action" });
      return;
    }

    const commandId = `cmd-${Date.now()}`;
    const command   = { commandId, action, params };

    if (targetId) {
      const client = sseClients.get(targetId);
      if (!client) {
        sendJson(res, 404, { error: `Agent ${targetId} not connected` });
        return;
      }
      sseWrite(client.res, "command", command);
      log(`📡 COMMAND SENT → ${targetId}  action: ${action}`);
      sendJson(res, 200, { ok: true, commandId, sentTo: [targetId] });
    } else {
      // Broadcast to all connected agents
      const recipients = [];
      for (const [id, client] of sseClients) {
        sseWrite(client.res, "command", command);
        recipients.push(id);
      }
      log(`📡 COMMAND BROADCAST  action: ${action}  recipients: ${recipients.length}`);
      sendJson(res, 200, { ok: true, commandId, sentTo: recipients });
    }
    return;
  }

  // ── GET /status ─────────────────────────────────────────────────────────────
  // Simple status page showing connected agents.
  if (method === "GET" && path === "/status") {
    const agents = [...sseClients.keys()];
    sendJson(res, 200, {
      mock:            true,
      port:            PORT,
      connectedAgents: agents,
      uptime:          process.uptime(),
    });
    return;
  }

  // ── 404 ─────────────────────────────────────────────────────────────────────
  verbose("404", `${method} ${path}`);
  sendJson(res, 404, { error: `No mock handler for ${method} ${path}` });
}

// ── Start server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error("[mock-server] Unhandled error:", err);
    if (!res.headersSent) sendJson(res, 500, { error: "Internal mock server error" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║   👻  GhostLayer Mock Server  –  Running on port ${PORT}  ║
╚════════════════════════════════════════════════════════╝

Endpoints:
  POST  http://localhost:${PORT}/api/agents/heartbeat
  POST  http://localhost:${PORT}/api/tenant-events
  POST  http://localhost:${PORT}/api/reports/scan
  GET   http://localhost:${PORT}/api/agents/command-channel   (SSE)
  POST  http://localhost:${PORT}/api/agents/command-result
  POST  http://localhost:${PORT}/api/agents/send-command      (test helper)
  GET   http://localhost:${PORT}/status

To connect the local agent to this mock server, run:

  node index.js --api-key=test-key --dir=./sample-docs \\
                --saas-url=http://localhost:${PORT} --verbose

To send a remote command to a connected agent:

  curl -X POST http://localhost:${PORT}/api/agents/send-command \\
       -H "Content-Type: application/json" \\
       -d '{"action":"scan"}'
`);
});
