// API נתוני מגמה – 30 ימים אחרונים
import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../lib/middleware.js";
import { getTrendData } from "../../../lib/db.js";

export async function GET(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    const data = await getTrendData(organizationId);

    // חישוב השוואה שבועית
    const thisWeek = data.slice(-7).reduce((s, d) => s + d.blocks, 0);
    const lastWeek = data.slice(-14, -7).reduce((s, d) => s + d.blocks, 0);
    const weekChange = lastWeek > 0
      ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
      : 0;

    // חישוב השוואה חודשית
    const thisMonth = data.reduce((s, d) => s + d.blocks, 0);

    return NextResponse.json({
      trendData: data,
      summary: {
        thisWeek,
        lastWeek,
        weekChange,
        thisMonth,
      },
      organizationId,
    });
  } catch (err) {
    if (err.status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
