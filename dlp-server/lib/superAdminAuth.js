// Super Admin authentication middleware
// Checks x-super-admin-key header against SUPER_ADMIN_KEY env var

/**
 * Validates the super admin key from the request headers.
 * Throws a 401 error if the key is missing or invalid.
 * @param {Request} request
 */
export function requireSuperAdmin(request) {
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
