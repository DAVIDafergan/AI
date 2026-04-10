// PUT /api/organizations/policy – bulk-replace the DLP policy for the authenticated tenant.
// Used by PolicyManager.jsx to persist policy changes to MongoDB in a single request.
import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../../lib/middleware.js";
import { getPolicies, savePolicies } from "../../../../lib/db.js";
import { getDefaultPolicies } from "../../../../lib/policies.js";

// GET – fetch the full policy array for the authenticated tenant
export async function GET(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    let orgPolicies = await getPolicies(organizationId);
    if (!orgPolicies) {
      orgPolicies = getDefaultPolicies(organizationId);
      await savePolicies(organizationId, orgPolicies);
    }
    return NextResponse.json({ policies: orgPolicies, organizationId });
  } catch (err) {
    if (err.status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// PUT – replace the entire policy array for the authenticated tenant
export async function PUT(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    const body = await request.json();

    if (!Array.isArray(body.policies)) {
      return NextResponse.json(
        { error: "Request body must contain a 'policies' array" },
        { status: 400 }
      );
    }

    // Validate each policy entry has at minimum an id and enabled flag
    const invalid = body.policies.find(
      (p) => typeof p.id !== "string" || typeof p.enabled !== "boolean"
    );
    if (invalid) {
      return NextResponse.json(
        { error: "Each policy must have a string 'id' and boolean 'enabled'" },
        { status: 400 }
      );
    }

    await savePolicies(organizationId, body.policies);
    return NextResponse.json({ success: true, policies: body.policies, organizationId });
  } catch (err) {
    if (err.status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
