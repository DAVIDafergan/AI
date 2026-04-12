#!/usr/bin/env node
/**
 * local-proxy.js – GhostLayer Local Forward Proxy (Native App Defense)
 *
 * Problem:  The Chrome browser extension cannot protect native OS desktop apps
 * (e.g. Slack desktop, ChatGPT native app, VS Code Copilot) because those apps
 * bypass the browser entirely and make direct TLS connections to LLM APIs.
 *
 * Solution: This module starts a local HTTP/HTTPS forward proxy (default
 * 127.0.0.1:8877).  When the OS proxy setting is configured to point to this
 * proxy (or via PAC file), ALL outbound HTTP and HTTPS traffic from every app
 * on the machine is routed through here.
 *
 * Deep Content Inspection (DCI) pipeline:
 *   1.  The proxy receives a plaintext HTTP request or an HTTPS CONNECT tunnel.
 *   2.  For recognised LLM API hostnames the request body is forwarded to the
 *       local GhostLayer agent scanner endpoint for DCI before it hits the
 *       external network.
 *   3.  If the scanner returns { action: "block" } the proxy returns a 403 to
 *       the originating app and the sensitive data never leaves the machine.
 *   4.  If the scanner returns { action: "allow" } or is unreachable (fail-open
 *       mode, configurable) the request is forwarded to the upstream server.
 *
 * TLS interception (MITM) for HTTPS:
 *   Full request-body inspection of encrypted traffic requires man-in-the-middle
 *   TLS termination.  This scaffolding sets up the plumbing; the actual MITM
 *   certificate infrastructure (a local CA + per-SNI cert generation) is stubbed
 *   here and can be wired in with a library such as `node-forge` or `mitmproxy`.
 *   Without MITM the proxy operates in *tunnel mode* for HTTPS – it can still
 *   block connections to known LLM hosts at the TCP level before the TLS
 *   handshake completes.
 *
 * Usage:
 *   node local-proxy.js [--port 8877] [--agent-url http://127.0.0.1:3001]
 *
 * Environment variables:
 *   PROXY_PORT       – Listening port  (default: 8877)
 *   PROXY_BIND       – Bind address    (default: 127.0.0.1)
 *   AGENT_URL        – GhostLayer agent base URL (default: http://127.0.0.1:3001)
 *   PROXY_FAIL_OPEN  – "true" to allow traffic when the agent is unreachable
 *                      (default: "true")
 *   PROXY_LOG_LEVEL  – "verbose" | "info" | "error" (default: "info")
 *
 * @module local-proxy
 */

import http         from "http";
import https        from "https";
import net          from "net";
import { URL }      from "url";

// ── Configuration ─────────────────────────────────────────────────────────────

const PROXY_PORT      = parseInt(process.env.PROXY_PORT  || "8877",                    10);
const PROXY_BIND      = process.env.PROXY_BIND            || "127.0.0.1";
const AGENT_URL       = process.env.AGENT_URL             || "http://127.0.0.1:3001";
const FAIL_OPEN       = (process.env.PROXY_FAIL_OPEN      || "true") === "true";
const LOG_LEVEL       = process.env.PROXY_LOG_LEVEL       || "info";

/**
 * Hostnames that are recognised as LLM / AI API endpoints.
 * Traffic to these hosts is routed through the DCI pipeline.
 * Add or remove entries as the LLM ecosystem evolves.
 */
const LLM_API_HOSTS = new Set([
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",  // Google Gemini
  "api.cohere.ai",
  "api.cohere.com",
  "api.mistral.ai",
  "api.perplexity.ai",
  "api.together.xyz",
  "api.groq.com",
  "bedrock-runtime.us-east-1.amazonaws.com",  // AWS Bedrock (us-east-1)
  "bedrock-runtime.eu-west-1.amazonaws.com",  // AWS Bedrock (eu-west-1)
  "cognitiveservices.azure.com",              // Azure OpenAI (matched as suffix)
]);

// ── Logging ───────────────────────────────────────────────────────────────────

const LOG_LEVELS = { error: 0, info: 1, verbose: 2 };
const currentLogLevel = LOG_LEVELS[LOG_LEVEL] ?? 1;

function log(level, ...args) {
  if ((LOG_LEVELS[level] ?? 1) <= currentLogLevel) {
    const ts = new Date().toISOString();
    console[level === "error" ? "error" : "log"](`[${ts}] [proxy:${level}]`, ...args);
  }
}

// ── LLM host detection ────────────────────────────────────────────────────────

/**
 * Returns true when `hostname` belongs to a known LLM API provider.
 * Supports exact matches and suffix-based matching (e.g. *.openai.azure.com).
 *
 * @param {string} hostname
 * @returns {boolean}
 */
function isLlmHost(hostname) {
  const h = hostname.toLowerCase();
  if (LLM_API_HOSTS.has(h)) return true;
  // Suffix-based matching: Azure OpenAI sub-domains, etc.
  for (const known of LLM_API_HOSTS) {
    if (known.startsWith(".") && h.endsWith(known)) return true;
    if (h.endsWith(`.${known}`)) return true;
  }
  return false;
}

// ── DCI pipeline ─────────────────────────────────────────────────────────────

/**
 * Send request body to the GhostLayer agent for Deep Content Inspection.
 *
 * @param {{
 *   host:    string,
 *   path:    string,
 *   method:  string,
 *   headers: Record<string,string>,
 *   body:    string,
 * }} requestContext
 * @returns {Promise<{ action: "allow" | "block", reason?: string }>}
 */
async function runDci(requestContext) {
  return new Promise((resolve) => {
    const payload = Buffer.from(
      JSON.stringify({
        source:  "local-proxy",
        host:    requestContext.host,
        path:    requestContext.path,
        method:  requestContext.method,
        body:    requestContext.body,
      }),
    );

    const agentEndpoint = new URL(`${AGENT_URL}/api/check-text`);
    const options = {
      hostname: agentEndpoint.hostname,
      port:     agentEndpoint.port || 3001,
      path:     agentEndpoint.pathname,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": payload.length,
        "X-Proxy-Source": "ghostlayer-local-proxy",
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ action: parsed.action || "allow", reason: parsed.reason });
        } catch {
          resolve({ action: "allow" });
        }
      });
    });

    req.on("error", (err) => {
      log("verbose", `DCI agent unreachable: ${err.message}`);
      resolve({ action: FAIL_OPEN ? "allow" : "block", reason: "agent-unreachable" });
    });

    req.setTimeout(3000, () => {
      req.destroy();
      resolve({ action: FAIL_OPEN ? "allow" : "block", reason: "agent-timeout" });
    });

    req.write(payload);
    req.end();
  });
}

// ── Plain-HTTP proxy handler ──────────────────────────────────────────────────

/**
 * Handle a plain HTTP request (non-CONNECT).
 * Collects the request body, runs DCI if the host is an LLM endpoint,
 * then forwards or blocks.
 *
 * @param {http.IncomingMessage} clientReq
 * @param {http.ServerResponse}  clientRes
 */
function handleHttpRequest(clientReq, clientRes) {
  const target = new URL(clientReq.url.startsWith("http")
    ? clientReq.url
    : `http://${clientReq.headers.host}${clientReq.url}`);

  const host = target.hostname;
  log("verbose", `HTTP  ${clientReq.method} ${host}${target.pathname}`);

  const bodyChunks = [];
  clientReq.on("data", (chunk) => bodyChunks.push(chunk));
  clientReq.on("end", async () => {
    const bodyBuffer = Buffer.concat(bodyChunks);
    const bodyText   = bodyBuffer.toString("utf8");

    if (isLlmHost(host)) {
      log("info", `[DCI] Inspecting LLM request → ${host}`);
      const result = await runDci({
        host,
        path:    target.pathname,
        method:  clientReq.method,
        headers: clientReq.headers,
        body:    bodyText,
      });

      if (result.action === "block") {
        log("info", `[DCI] BLOCKED  ${host} – ${result.reason || "policy violation"}`);
        clientRes.writeHead(403, { "Content-Type": "application/json" });
        clientRes.end(JSON.stringify({
          error:    "GhostLayer DLP: request blocked",
          reason:   result.reason || "policy violation",
          host,
        }));
        return;
      }

      log("verbose", `[DCI] Allowed  ${host}`);
    }

    // ── Forward the request upstream ──
    const upstreamOptions = {
      hostname: host,
      port:     target.port || 80,
      path:     target.pathname + (target.search || ""),
      method:   clientReq.method,
      headers:  { ...clientReq.headers, host },
    };

    const upstreamReq = http.request(upstreamOptions, (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(clientRes);
    });

    upstreamReq.on("error", (err) => {
      log("error", `Upstream error for ${host}: ${err.message}`);
      if (!clientRes.headersSent) {
        clientRes.writeHead(502);
        clientRes.end("Bad Gateway");
      }
    });

    if (bodyBuffer.length > 0) upstreamReq.write(bodyBuffer);
    upstreamReq.end();
  });
}

// ── HTTPS CONNECT tunnel handler ─────────────────────────────────────────────

/**
 * Handle an HTTPS CONNECT tunnel request.
 *
 * Two operating modes:
 *
 * 1. TUNNEL MODE (default, no MITM):
 *    The proxy establishes a raw TCP connection to the upstream server and
 *    pipes bytes in both directions.  It cannot read the encrypted payload,
 *    but it *can* block connections to known LLM hosts at the TCP level before
 *    TLS negotiation begins.
 *
 * 2. MITM MODE (future, requires local CA):
 *    With a local certificate authority installed in the OS/app trust stores,
 *    the proxy can terminate TLS, inspect the plaintext request body, run DCI,
 *    and re-encrypt toward the upstream.  Stub wired in below.
 *
 * @param {http.IncomingMessage} clientReq
 * @param {net.Socket}           clientSocket
 * @param {Buffer}               head
 */
function handleConnectTunnel(clientReq, clientSocket, head) {
  const [host, portStr] = clientReq.url.split(":");
  const port = parseInt(portStr || "443", 10);

  log("verbose", `CONNECT ${host}:${port}`);

  // ── TCP-level block for LLM hosts (no MITM needed) ───────────────────────
  if (isLlmHost(host)) {
    // TODO (Sprint 7): Engage MITM TLS interception here so the full request
    // body can be inspected.  For now we block at TCP level.
    log("info", `[DCI] TCP-block CONNECT → ${host}:${port} (LLM API endpoint)`);
    clientSocket.write(
      "HTTP/1.1 403 Forbidden\r\n" +
      "Content-Type: application/json\r\n" +
      "X-GhostLayer: blocked\r\n\r\n",
    );
    clientSocket.end(JSON.stringify({
      error:  "GhostLayer DLP: connection blocked",
      reason: "LLM API endpoint detected – MITM inspection required",
      host,
    }));
    return;
  }

  // ── Pass-through tunnel for non-LLM HTTPS traffic ────────────────────────
  const upstreamSocket = net.connect(port, host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  upstreamSocket.on("error", (err) => {
    log("verbose", `Tunnel error for ${host}: ${err.message}`);
    clientSocket.destroy();
  });

  clientSocket.on("error", () => upstreamSocket.destroy());
}

// ── MITM TLS stub (Sprint 7 hook) ────────────────────────────────────────────

/**
 * Placeholder for full MITM TLS interception.
 *
 * To enable MITM mode:
 *   1.  Generate a root CA with node-forge or openssl and install it in the OS
 *       and application trust stores.
 *   2.  Implement `generateSignedCert(hostname)` to issue a per-SNI leaf cert
 *       signed by the local CA.
 *   3.  Replace `handleConnectTunnel`'s pass-through path with an
 *       `tls.createServer({ SNICallback })` that terminates TLS, reads the
 *       plaintext body, calls `runDci()`, and re-establishes a new TLS
 *       connection toward the real upstream server.
 *
 * @param {string} hostname  SNI hostname from the TLS ClientHello.
 * @returns {Promise<{ cert: Buffer, key: Buffer }>}
 */
// eslint-disable-next-line no-unused-vars
async function generateMitmCert(hostname) {
  // TODO (Sprint 7): implement with node-forge
  throw new Error("MITM certificate generation not yet implemented");
}

// ── Proxy server ─────────────────────────────────────────────────────────────

const server = http.createServer(handleHttpRequest);

server.on("connect", handleConnectTunnel);

server.on("error", (err) => {
  log("error", `Proxy server error: ${err.message}`);
});

/**
 * Start the proxy server.
 *
 * @param {number} [port]  Override PROXY_PORT env var.
 * @param {string} [bind]  Override PROXY_BIND env var.
 * @returns {Promise<http.Server>}
 */
export function startProxy(port = PROXY_PORT, bind = PROXY_BIND) {
  return new Promise((resolve, reject) => {
    server.listen(port, bind, () => {
      log("info", `GhostLayer local proxy listening on ${bind}:${port}`);
      log("info", `DCI agent endpoint: ${AGENT_URL}`);
      log("info", `Fail-open mode: ${FAIL_OPEN}`);
      log("info", `Monitoring ${LLM_API_HOSTS.size} LLM API hosts`);
      resolve(server);
    });
    server.once("error", reject);
  });
}

// ── CLI entry-point ───────────────────────────────────────────────────────────

// Run directly: `node local-proxy.js`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  startProxy().catch((err) => {
    console.error("Failed to start proxy:", err.message);
    process.exit(1);
  });
}
