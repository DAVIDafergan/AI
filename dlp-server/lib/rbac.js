/**
 * Role-Based Access Control (RBAC) utilities
 *
 * Roles (least → most privileged):
 *   auditor           – read-only access to their tenant's data
 *   security_analyst  – read + write for scan/alert operations
 *   tenant_admin      – full control including policy changes and API key management
 *
 * Usage in an API route:
 *
 *   import { requireTenantRole } from "../../../lib/rbac.js";
 *
 *   // Inside a handler that already has a session (next-auth) or a verified JWT:
 *   await requireTenantRole(session, ["tenant_admin"]);
 */

import { connectMongo, TenantUser } from "./db.js";

// Role hierarchy: higher value = more privileged
const ROLE_PRIORITY = {
  auditor:          0,
  security_analyst: 1,
  tenant_admin:     2,
};

/**
 * Returns true if `userRole` satisfies the minimum required role.
 *
 * @param {string} userRole       – the role the user currently holds
 * @param {string} requiredRole   – the minimum role needed
 * @returns {boolean}
 */
export function hasMinimumRole(userRole, requiredRole) {
  return (ROLE_PRIORITY[userRole] ?? -1) >= (ROLE_PRIORITY[requiredRole] ?? 0);
}

/**
 * Throws a 403 HTTP error unless the authenticated user has at least one of
 * the specified roles within the given tenant.
 *
 * Accepts either:
 *   - A full `session` object from next-auth (populated by `lib/auth.js`)
 *   - A plain `{ tenantId, email, role }` payload (from a verified JWT)
 *
 * @param {{ tenantId: string, email: string, role?: string }} identity
 * @param {string[]} allowedRoles  – e.g. ["tenant_admin"]
 * @returns {Promise<import("./db.js").TenantUser>}
 */
export async function requireTenantRole(identity, allowedRoles) {
  if (!identity?.email || !identity?.tenantId) {
    throw Object.assign(new Error("Unauthorized: missing identity"), { status: 401 });
  }

  // If the role was already resolved (e.g. from JWT), skip the DB lookup
  let role = identity.role;

  if (!role) {
    await connectMongo();
    const tenantUser = await TenantUser.findOne({
      tenantId: identity.tenantId,
      email:    identity.email,
    }).lean();

    if (!tenantUser) {
      throw Object.assign(
        new Error("Forbidden: user is not a member of this tenant"),
        { status: 403 }
      );
    }
    role = tenantUser.role;
  }

  const permitted = allowedRoles.some((allowed) => hasMinimumRole(role, allowed));

  if (!permitted) {
    throw Object.assign(
      new Error(`Forbidden: role '${role}' is not allowed. Required: ${allowedRoles.join(" or ")}`),
      { status: 403 }
    );
  }

  return { email: identity.email, tenantId: identity.tenantId, role };
}

/**
 * Helper: require that the caller is a tenant_admin.
 * Wraps requireTenantRole for the common case.
 *
 * @param {{ tenantId: string, email: string, role?: string }} identity
 */
export async function requireTenantAdmin(identity) {
  return requireTenantRole(identity, ["tenant_admin"]);
}

/**
 * Helper: require that the caller can at least read data
 * (security_analyst or tenant_admin).
 *
 * @param {{ tenantId: string, email: string, role?: string }} identity
 */
export async function requireSecurityAnalystOrAbove(identity) {
  return requireTenantRole(identity, ["security_analyst"]);
}
