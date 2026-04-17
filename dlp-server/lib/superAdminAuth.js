// Super Admin authentication middleware
// Accepts either a valid JWT in the super_admin_auth cookie or a valid x-super-admin-key header

import { cookies } from "next/headers";
import { verifySuperAdminSessionToken } from "./superAdminSession.js";

/**
 * Validates the request as coming from a super admin.
 * Accepts:
 *   1. A valid JWT stored in the `super_admin_auth` cookie (set by the login form).
 *   2. A valid `x-super-admin-key` header matching SUPER_ADMIN_KEY env var.
 * Throws a 401 error if neither check passes.
 * @param {Request} request
 */
export async function requireSuperAdmin(request) {
  // 1. Accept JWT cookie-based auth (dashboard login via username/password)
  const jwtSecret = process.env.JWT_SECRET;
  if (jwtSecret) {
    try {
      const cookieStore = await cookies();
      const authCookie = cookieStore.get("super_admin_auth");
      if (authCookie?.value) {
        await verifySuperAdminSessionToken(authCookie.value, jwtSecret);
        return;
      }
    } catch (e) {
      if (e.code === "ERR_JWT_EXPIRED" || e.code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" || e.code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
        const err = new Error("Unauthorized: Invalid or expired session token");
        err.status = 401;
        throw err;
      }
      // cookies() may throw outside of a request context; fall through to key check
      console.error("[superAdminAuth] Unexpected error during cookie check:", e);
    }
  }

  // 2. Accept API-key-based auth (super-admin page or external callers)
  const provided = request.headers.get("x-super-admin-key");
  const expected = process.env.SUPER_ADMIN_KEY;

  if (!expected) {
    // If no key is configured, block all access
    const err = new Error("Super admin access not configured");
    err.status = 401;
    throw err;
  }

  if (!provided || provided !== expected) {
    const err = new Error("Unauthorized: Invalid super admin key");
    err.status = 401;
    throw err;
  }
}
