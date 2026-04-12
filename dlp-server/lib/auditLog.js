/**
 * Immutable Audit Log helper — "the black box"
 *
 * Usage:
 *   import { recordAuditLog } from "../../../lib/auditLog.js";
 *
 *   await recordAuditLog({
 *     tenantId: "...",
 *     actorId:  "user@example.com",
 *     action:   "ROTATE_API_KEY",
 *     resource: "tenant:<id>",
 *     ipAddress: request.headers.get("x-forwarded-for") ?? "",
 *   });
 */

import { connectMongo, AuditLog } from "./db.js";

/**
 * Persist an audit-log entry.  Never throws — failures are logged to stderr so
 * that a logging error never blocks a critical admin operation.
 *
 * @param {{
 *   tenantId:  string | import("mongoose").Types.ObjectId,
 *   actorId:   string,
 *   action:    "GENERATE_API_KEY"|"VIEW_API_KEY"|"ROTATE_API_KEY"|"CHANGE_POLICY"|
 *              "CREATE_POLICY"|"DELETE_POLICY"|"CREATE_TENANT"|"UPDATE_TENANT"|
 *              "DELETE_TENANT"|"PROVISION_AGENT"|"LOGIN",
 *   resource:  string,
 *   ipAddress?: string,
 *   metadata?:  Record<string, unknown>,
 * }} data
 * @returns {Promise<void>}
 */
export async function recordAuditLog(data) {
  try {
    await connectMongo();
    await AuditLog.create({
      tenantId:  data.tenantId,
      actorId:   data.actorId,
      action:    data.action,
      resource:  data.resource,
      ipAddress: data.ipAddress ?? "",
      timestamp: new Date(),
      metadata:  data.metadata,
    });
  } catch (err) {
    // Audit log failures must never surface as user-facing errors
    console.error("[auditLog] Failed to record audit entry:", err.message, data);
  }
}

/**
 * Extract the caller's IP address from a Next.js Request object.
 * Prefers the X-Forwarded-For header (set by proxies / load-balancers).
 *
 * @param {Request} request
 * @returns {string}
 */
export function getClientIp(request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    ""
  );
}
