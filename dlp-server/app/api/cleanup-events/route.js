import { NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../lib/superAdminAuth.js";
import { connectMongo, Tenant, TenantEvent } from "../../../lib/db.js";

export const dynamic = "force-dynamic";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-super-admin-key",
};

/**
 * POST /api/cleanup-events
 *
 * Super-admin endpoint that retroactively enforces per-tenant data-retention
 * policies.  For each tenant it deletes TenantEvents whose timestamp is older
 * than the tenant's configured retentionDays (falling back to 30 days when not
 * set).
 *
 * This covers:
 *   - Events created before the expireAt field was added to the schema.
 *   - Tenants whose retentionDays setting was tightened after events were stored.
 *
 * Returns a summary of how many events were deleted per tenant.
 *
 * Authentication: requires x-super-admin-key header.
 */
export async function POST(request) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();

    const tenants = await Tenant.find({}, { _id: 1, name: 1, settings: 1 }).lean();

    const summary = [];
    let totalDeleted = 0;

    for (const tenant of tenants) {
      const retentionDays = tenant.settings?.retentionDays ?? 30;
      const cutoff        = new Date(Date.now() - retentionDays * MS_PER_DAY);

      const result = await TenantEvent.deleteMany({
        tenantId:  tenant._id,
        timestamp: { $lt: cutoff },
      });

      if (result.deletedCount > 0) {
        summary.push({
          tenantId:     tenant._id,
          tenantName:   tenant.name,
          retentionDays,
          deletedCount: result.deletedCount,
        });
        totalDeleted += result.deletedCount;
      }
    }

    return NextResponse.json(
      {
        ok:              true,
        totalDeleted,
        tenantsAffected: summary.length,
        summary,
        executedAt:      new Date().toISOString(),
      },
      { headers: CORS_HEADERS },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err.message },
      { status: err.status || 500, headers: CORS_HEADERS },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
