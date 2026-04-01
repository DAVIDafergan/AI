/**
 * cloud-sync.js – Sends telemetry metadata to the GhostLayer SaaS dashboard.
 *
 * CRITICAL: Only aggregate metadata counts and event metadata are transmitted.
 *           Sensitive content, entity names, file paths, embeddings, or any
 *           file content NEVER leave this machine.
 */

// Use the built-in fetch available in Node ≥ 18.

const DEFAULT_SERVER_URL = "https://ghostlayer.up.railway.app";

/**
 * Send a heartbeat POST to the SaaS `/api/agents/heartbeat` endpoint.
 *
 * @param {{
 *   apiKey: string,
 *   serverUrl?: string,
 *   filesScanned: number,
 *   sensitiveTermsFound: number,
 *   highlySensitiveFiles?: number,
 *   sensitiveFiles?: number,
 *   averageSensitivityScore?: number,
 *   entitiesFound?: { persons: number, orgs: number },
 * }} options
 * @returns {Promise<{ ok: boolean, status: number, body: object }>}
 */
export async function sendHeartbeat({
  apiKey,
  serverUrl,
  filesScanned,
  sensitiveTermsFound,
  highlySensitiveFiles    = 0,
  sensitiveFiles          = 0,
  averageSensitivityScore = 0,
  entitiesFound           = { persons: 0, orgs: 0 },
}) {
  const baseUrl = (serverUrl || DEFAULT_SERVER_URL).replace(/\/$/, "");
  const url = `${baseUrl}/api/agents/heartbeat`;

  const payload = {
    status:                  "Active",
    filesScanned,
    sensitiveTermsFound,
    highlySensitiveFiles,
    sensitiveFiles,
    averageSensitivityScore,
    entitiesFound,
    agentVersion: "3.0.0",
    timestamp:    new Date().toISOString(),
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  let body = {};
  try {
    body = await response.json();
  } catch {
    // Non-JSON response – not critical
  }

  return { ok: response.ok, status: response.status, body };
}

/**
 * Send a single DLP action event to the cloud `/api/tenant-events` endpoint.
 * Only metadata is transmitted – no raw sensitive text is ever included.
 *
 * This function is fire-and-forget: it silently absorbs network errors so that
 * a cloud connectivity issue never interrupts the local DLP operation.
 *
 * @param {{
 *   tenantApiKey: string,
 *   serverUrl?: string,
 *   userEmail?: string,
 *   action: "BLOCKED" | "MASKED",
 *   sensitivityLevel?: string,
 *   matchedEntities?: string[],
 * }} options
 * @returns {Promise<void>}
 */
export async function sendTenantEvent({
  tenantApiKey,
  serverUrl,
  userEmail       = "unknown",
  action,
  sensitivityLevel = "medium",
  matchedEntities  = [],
}) {
  const baseUrl = (serverUrl || DEFAULT_SERVER_URL).replace(/\/$/, "");
  const url = `${baseUrl}/api/tenant-events`;

  const payload = {
    tenantApiKey,
    userEmail,
    action,
    sensitivityLevel,
    matchedEntities,
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Network errors are non-critical – do not block local operation
  }
}

/**
 * Start sending periodic telemetry (aggregate scan/block counts only) to the
 * GhostLayer dashboard.  No sensitive content is ever included.
 *
 * @param {{
 *   apiKey: string,
 *   serverUrl?: string,
 *   getMetrics: () => { totalScans: number, totalBlocks: number },
 *   intervalMs?: number,
 *   verbose?: boolean,
 * }} options
 * @returns {{ stop: () => void }}  Call stop() to cancel the interval.
 */
export function startPeriodicTelemetry({
  apiKey,
  serverUrl,
  getMetrics,
  intervalMs = 5 * 60 * 1000, // every 5 minutes by default
  verbose    = false,
}) {
  const timer = setInterval(async () => {
    const { totalScans, totalBlocks } = getMetrics();
    try {
      const result = await sendHeartbeat({
        apiKey,
        serverUrl,
        filesScanned:        totalScans,
        sensitiveTermsFound: totalBlocks,
      });
      if (verbose) {
        console.log(
          `[cloud-sync] Telemetry sent – scans: ${totalScans}, blocks: ${totalBlocks}` +
          ` (HTTP ${result.status})`,
        );
      }
    } catch (err) {
      if (verbose) {
        console.warn(`[cloud-sync] Telemetry error: ${err.message}`);
      }
    }
  }, intervalMs);

  return { stop: () => clearInterval(timer) };
}
