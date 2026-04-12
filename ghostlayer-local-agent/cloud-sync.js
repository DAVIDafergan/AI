/**
 * cloud-sync.js – Sends telemetry metadata to the GhostLayer SaaS dashboard.
 *
 * CRITICAL: Only aggregate metadata counts and event metadata are transmitted.
 *           Sensitive content, entity names, file paths, embeddings, or any
 *           file content NEVER leave this machine.
 *
 * Offline resilience: When the Central Server is unreachable, TenantEvent
 * payloads are handed off to the offline spooler (offline-spooler.js) which
 * persists them in an encrypted local SQLite database and retries delivery
 * with exponential backoff once connectivity is restored.
 */

// Use the built-in fetch available in Node ≥ 18.
import { enqueue } from "./offline-spooler.js";

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
 * @param {{
 *   tenantApiKey: string,
 *   serverUrl?: string,
 *   userEmail?: string,
 *   action: "BLOCKED" | "MASKED" | "BEHAVIOR_BLOCK",
 *   sensitivityLevel?: string,
 *   matchedEntities?: string[],
 *   detectionTier?: string,
 *   evasionTechniques?: string[],
 *   behaviorRiskScore?: number,
 *   anomalyFlags?: string[],
 *   context?: object,
 * }} options
 * @returns {Promise<void>}
 */
export async function sendTenantEvent({
  tenantApiKey,
  serverUrl,
  userEmail         = "unknown",
  action,
  sensitivityLevel  = "medium",
  matchedEntities   = [],
  detectionTier     = "unknown",
  evasionTechniques = [],
  behaviorRiskScore = 0,
  anomalyFlags      = [],
  context           = {},
}) {
  const baseUrl = (serverUrl || DEFAULT_SERVER_URL).replace(/\/$/, "");
  const url = `${baseUrl}/api/tenant-events`;

  const payload = {
    tenantApiKey,
    userEmail,
    action,
    sensitivityLevel,
    matchedEntities,
    detectionTier,
    evasionTechniques,
    behaviorRiskScore,
    anomalyFlags,
    context,
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    // On delivery success nothing more to do.
    if (res.ok) return;
    // Non-2xx response (server error, rate-limit, etc.) – spool for retry.
    enqueue(payload);
  } catch {
    // Network error (offline, DNS failure, timeout) – spool for retry.
    enqueue(payload);
  }
}

/**
 * Send a scan report POST to the SaaS `/api/reports/scan` endpoint.
 * Reports aggregate file scan statistics – no sensitive content is included.
 *
 * @param {{
 *   apiKey: string,
 *   serverUrl?: string,
 *   totalFilesScanned: number,
 *   durationSeconds: number,
 * }} options
 * @returns {Promise<{ ok: boolean, status: number, body: object }>}
 */
export async function sendScanReport({
  apiKey,
  serverUrl,
  totalFilesScanned,
  durationSeconds,
}) {
  const baseUrl = (serverUrl || DEFAULT_SERVER_URL).replace(/\/$/, "");
  const url = `${baseUrl}/api/reports/scan`;

  const payload = {
    totalFilesScanned,
    durationSeconds,
    timestamp: new Date().toISOString(),
  };

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Network failure – return a structured error so callers can handle gracefully
    return { ok: false, status: 0, body: { error: err.message } };
  }

  let body = {};
  try {
    body = await response.json();
  } catch {
    // Non-JSON response – not critical
  }

  return { ok: response.ok, status: response.status, body };
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
