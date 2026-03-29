// Middleware לאימות בקשות API מבוסס x-api-key
import { validateApiKey } from "./db.js";

/**
 * מאמת בקשת HTTP לפי header x-api-key
 * @param {Request} request - בקשת Next.js
 * @returns {{ organizationId: string, orgName: string }}
 */
export async function authenticateRequest(request) {
  const apiKey = request.headers.get("x-api-key");

  // ללא מפתח → fallback לארגון ברירת מחדל (לתאימות לאחור)
  if (!apiKey) {
    return { organizationId: "default-org", orgName: "ארגון ברירת מחדל" };
  }

  const result = validateApiKey(apiKey);
  if (!result) {
    // מפתח לא תקין – throw object שניתן לתפוס
    const err = new Error("Unauthorized: Invalid API key");
    err.status = 401;
    throw err;
  }

  return result;
}
