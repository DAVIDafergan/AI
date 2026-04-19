/**
 * command-channel.js – Connects to the GhostLayer server's SSE command channel
 * and executes commands sent from the dashboard.
 *
 * This module enables Zero-Touch remote management: the super-admin can trigger
 * scans, retrieve logs, or deactivate the agent directly from the dashboard
 * without SSH or any inbound network access.
 *
 * The connection is outbound-only (agent → server) which means no firewall
 * rules need to be changed on the customer's side.
 */

const DEFAULT_SERVER_URL = "https://ghostlayer.up.railway.app";
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 120_000;

/**
 * Start the command channel connection.
 *
 * @param {{
 *   apiKey: string,
 *   serverUrl?: string,
 *   verbose?: boolean,
 *   onScan?: () => Promise<void>,
 *   onGetLogs?: () => Promise<string>,
 *   onDeactivate?: () => void,
 * }} options
 * @returns {{ stop: () => void }}
 */
export function startCommandChannel({
  apiKey,
  serverUrl,
  verbose = false,
  onScan,
  onGetLogs,
  onDeactivate,
}) {
  let stopped = false;
  let attempt = 0;

  async function connect() {
    if (stopped) return;

    const baseUrl = (serverUrl || DEFAULT_SERVER_URL).replace(/\/$/, "");
    const url = `${baseUrl}/api/agents/command-channel`;

    try {
      if (verbose) console.log(`[command-channel] Connecting to ${url} …`);

      const controller = new AbortController();
      const response = await fetch(url, {
        headers: {
          "x-api-key": apiKey,
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from command-channel endpoint`);
      }

      if (verbose) console.log("[command-channel] ✓ Connected to dashboard command channel.");
      attempt = 0; // reset back-off on success

      // Parse the SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split completed SSE event blocks (separated by blank lines)
        const blocks = buffer.split(/\n\n/);
        buffer = blocks.pop() ?? ""; // last (possibly incomplete) block stays in buffer

        for (const block of blocks) {
          if (!block.trim() || block.startsWith(":")) continue; // comments / keep-alive pings

          let eventName = "message";
          let dataStr = "";

          for (const line of block.split(/\n/)) {
            if (line.startsWith("event: ")) eventName = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataStr = line.slice(6).trim();
          }

          if (!dataStr) continue;

          let data;
          try {
            data = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (eventName === "connected") {
            if (verbose)
              console.log(`[command-channel] Registered – agentId: ${data.agentId}`);
          } else if (eventName === "command") {
            // Handle in background so the read-loop isn't blocked
            handleCommand(data, {
              apiKey,
              serverUrl: baseUrl,
              verbose,
              onScan,
              onGetLogs,
              onDeactivate,
            }).catch((err) => {
              if (verbose)
                console.error(`[command-channel] Error handling command: ${err.message}`);
            });
          }
        }
      }

      reader.cancel().catch(() => {});
    } catch (err) {
      if (stopped) return;
      if (verbose) console.warn(`[command-channel] Connection lost: ${err.message}`);
    }

    if (!stopped) {
      const delay = Math.min(RECONNECT_BASE_MS * 1.5 ** attempt++, RECONNECT_MAX_MS);
      if (verbose)
        console.log(
          `[command-channel] Reconnecting in ${(delay / 1000).toFixed(0)}s … (attempt ${attempt})`
        );
      await new Promise((r) => setTimeout(r, delay));
      connect();
    }
  }

  // Start the connection loop without blocking the caller
  connect().catch((err) => {
    if (verbose) console.error(`[command-channel] Unexpected error in connection loop: ${err.message}`);
  });

  return {
    stop() {
      stopped = true;
    },
  };
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function handleCommand(
  command,
  { apiKey, serverUrl, verbose, onScan, onGetLogs, onDeactivate }
) {
  const { commandId, action, params = {} } = command;

  if (verbose) console.log(`[command-channel] ▶ Received command: ${action} (id: ${commandId})`);

  switch (action) {
    case "scan": {
      if (onScan) {
        console.log("[command-channel] ▶ Remote scan triggered from dashboard …");
        await onScan(params);
        console.log("[command-channel] ✓ Remote scan complete.");
      }
      break;
    }

    case "get-logs": {
      const logs = onGetLogs ? await onGetLogs() : "No logs available.";
      await postCommandResult({ commandId, action, result: { logs }, apiKey, serverUrl });
      break;
    }

    case "deactivate": {
      console.log("[command-channel] ▶ Deactivate command received – shutting down agent …");
      if (onDeactivate) {
        onDeactivate();
      } else {
        process.exit(0);
      }
      break;
    }

    case "update-config": {
      if (verbose && params)
        console.log(`[command-channel] Config update received: ${JSON.stringify(params)}`);
      await postCommandResult({
        commandId,
        action,
        result: { ok: true, note: "Config received. Restart agent to apply." },
        apiKey,
        serverUrl,
      });
      break;
    }

    default:
      if (verbose) console.warn(`[command-channel] Unknown action ignored: ${action}`);
  }
}

async function postCommandResult({ commandId, action, result, apiKey, serverUrl }) {
  try {
    const url = `${serverUrl}/api/agents/command-result`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        commandId,
        action,
        result,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Best-effort – non-critical
  }
}
