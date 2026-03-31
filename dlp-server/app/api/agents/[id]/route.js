import { NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../../lib/superAdminAuth.js";
import { connectMongo, Agent } from "../../../../lib/db.js";

// GET /api/agents/[id]
export async function GET(request, { params }) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();
    const agent = await Agent.findById(params.id).lean();
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    return NextResponse.json({ agent });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

// PUT /api/agents/[id]
export async function PUT(request, { params }) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();
    const body = await request.json();
    const agent = await Agent.findByIdAndUpdate(params.id, body, { new: true, runValidators: true }).lean();
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    return NextResponse.json({ agent });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

// DELETE /api/agents/[id]
export async function DELETE(request, { params }) {
  try {
    await requireSuperAdmin(request);
    await connectMongo();
    const agent = await Agent.findByIdAndDelete(params.id).lean();
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    return NextResponse.json({ deleted: true, id: params.id });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-super-admin-key",
    },
  });
}
