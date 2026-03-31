import { NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../lib/superAdminAuth.js";
import { connectMongo, Tenant } from "../../../lib/db.js";
import { randomUUID } from "crypto";

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// GET /api/tenants – list all tenants
export async function GET(request) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();
    const tenants = await Tenant.find({}).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ tenants });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

// POST /api/tenants – create tenant
export async function POST(request) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();
    const body = await request.json();
    const { name, contactEmail, contactName, plan, domain } = body;

    if (!name || !contactEmail) {
      return NextResponse.json({ error: "name and contactEmail are required" }, { status: 400 });
    }

    const apiKey = randomUUID();
    const { randomBytes } = await import("crypto");
    const apiSecret = randomBytes(32).toString("hex");
    const slug = slugify(name) || `tenant-${randomUUID()}`;

    const tenant = await Tenant.create({
      name,
      slug,
      apiKey,
      apiSecret,
      contactEmail,
      contactName,
      plan: plan || "starter",
      domain,
    });

    // Return full credentials ONCE – client should store them securely
    return NextResponse.json({
      tenant,
      credentials: { apiKey, apiSecret },
    }, { status: 201 });
  } catch (err) {
    if (err.code === 11000) {
      return NextResponse.json({ error: "Tenant name or slug already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-super-admin-key",
    },
  });
}
