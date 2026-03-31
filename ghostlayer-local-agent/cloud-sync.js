/**
 * cloud-sync.js – Sends a heartbeat to the GhostLayer SaaS dashboard.
 *
 * CRITICAL: Only metadata / counts are transmitted.
 *           The actual sensitive words, emails, or any file content
 *           NEVER leave this machine.
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
 * }} options
 * @returns {Promise<{ ok: boolean, body: object }>}
 */
export async function sendHeartbeat({ apiKey, saasUrl, filesScanned, sensitiveTermsFound }) {
  const baseUrl = (saasUrl || DEFAULT_SAAS_URL).replace(/\/$/, "");
  const url = `${baseUrl}/api/agents/heartbeat`;

  const payload = {
    status: "Active",
    filesScanned,
    sensitiveTermsFound,
    // The agent version – useful for the dashboard to detect outdated agents.
    agentVersion: "1.0.0",
    timestamp: new Date().toISOString(),
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
