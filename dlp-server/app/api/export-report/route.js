// API ייצוא דוח אבטחה מקיף
import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../lib/middleware.js";
import { generateReport } from "../../../lib/db.js";

export async function GET(request) {
  try {
    const { organizationId } = await authenticateRequest(request);
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "json";

    const report = generateReport(organizationId);

    if (format === "csv") {
      // המרה לפורמט CSV
      const BOM = "\uFEFF";
      const rows = [
        ["תאריך", "סוג מידע", "ציון איום", "מקור", "סטטוס"],
        ...report.recentEvents.map((e) => [
          e.timestamp,
          e.type,
          e.threatScore,
          e.source,
          e.status,
        ]),
      ];
      const csv = rows
        .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
        .join("\n");

      return new NextResponse(BOM + csv, {
        headers: {
          "Content-Type": "text/csv;charset=utf-8",
          "Content-Disposition": `attachment; filename="dlp-report-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    // ברירת מחדל: JSON
    return new NextResponse(JSON.stringify(report, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="dlp-report-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (err) {
    if (err.status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
