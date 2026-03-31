/**
 * cloud-sync.js – Sends an AI-powered scan report to the GhostLayer SaaS dashboard.
 *
 * CRITICAL: Only metadata / counts are transmitted.
 *           The actual sensitive content, entity names, file paths, or any
 *           file content NEVER leave this machine.
 */

// Use the built-in fetch available in Node ≥ 18.
// For older Node versions the user can install node-fetch.

const DEFAULT_SAAS_URL = "https://ghostlayer.up.railway.app";

/**
 * Send a heartbeat POST to the SaaS `/api/agents/heartbeat` endpoint.
 *
 * @param {{
 *   apiKey: string,
 *   saasUrl?: string,
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
  saasUrl,
  filesScanned,
  sensitiveTermsFound,
  highlySensitiveFiles    = 0,
  sensitiveFiles          = 0,
  averageSensitivityScore = 0,
  entitiesFound           = { persons: 0, orgs: 0 },
}) {
  const baseUrl = (saasUrl || DEFAULT_SAAS_URL).replace(/\/$/, "");
  const url = `${baseUrl}/api/agents/heartbeat`;

  const payload = {
    status:                  "Active",
    filesScanned,
    sensitiveTermsFound,
    highlySensitiveFiles,
    sensitiveFiles,
    averageSensitivityScore,
    entitiesFound,
    // The agent version – useful for the dashboard to detect outdated agents.
    agentVersion: "2.0.0",
    timestamp:    new Date().toISOString(),
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Authenticate with the tenant API key
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
