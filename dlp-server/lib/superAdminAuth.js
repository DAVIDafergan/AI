// Super Admin authentication middleware
// Accepts either a valid x-super-admin-key header or a valid super_admin_auth session cookie

import { cookies } from "next/headers";

/**
 * Validates the request as coming from a super admin.
 * Accepts:
 *   1. A valid `super_admin_auth` session cookie (set by the login form).
 *   2. A valid `x-super-admin-key` header matching SUPER_ADMIN_KEY env var.
 * Throws a 401 error if neither check passes.
 * @param {Request} request
 */
export async function requireSuperAdmin(request) {
  // 1. Accept cookie-based auth (dashboard login via username/password)
  try {
    const cookieStore = await cookies();
    const authCookie = cookieStore.get("super_admin_auth");
    if (authCookie && authCookie.value === "true") {
      return;
    }
  } catch {
    // cookies() may throw outside of a request context; fall through to key check
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
