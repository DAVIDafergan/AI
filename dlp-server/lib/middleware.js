// Middleware לאימות בקשות API מבוסס x-api-key
import { validateApiKey } from "./db.js";

/**
 * Returns CORS headers if the request's Origin is in the ALLOWED_ORIGINS
 * environment variable, or null if the origin is not permitted.
 *
 * ALLOWED_ORIGINS should be a comma-separated list of exact origins, e.g.:
 *   ALLOWED_ORIGINS=https://app.example.com,chrome-extension://abcdef123456
 *
 * @param {Request} request
 * @returns {Record<string,string>|null}
 */
export function getCorsHeaders(request) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const origin = request.headers.get("origin") || "";

  if (!allowedOrigins.includes(origin)) {
    return null;
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key, x-dlp-extension",
    Vary: "Origin",
  };
}

/**
 * מאמת בקשת HTTP לפי header x-api-key.
 * זורק שגיאת 401 אם המפתח חסר או אינו תקף.
 * @param {Request} request - בקשת Next.js
 * @returns {{ organizationId: string, orgName: string }}
 */
export async function authenticateRequest(request) {
  const apiKey = request.headers.get("x-api-key");

  if (!apiKey) {
    const err = new Error("Unauthorized: API key is required");
    err.status = 401;
    throw err;
  }

  const result = validateApiKey(apiKey);
  if (!result) {
    const err = new Error("Unauthorized: Invalid API key");
    err.status = 401;
    throw err;
  }

  return result;
}
