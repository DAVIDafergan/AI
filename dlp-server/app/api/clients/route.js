// API ניהול לקוחות (Client Onboarding)
import { NextResponse } from "next/server";
import {
  getAllOrganizationsWithStats,
  createOrganization,
  deleteOrganization,
  getApiKeysForOrg,
} from "../../../lib/db.js";

// GET – רשימת כל הלקוחות עם סטטיסטיקות
export async function GET() {
  try {
    const clients = getAllOrganizationsWithStats();
    return NextResponse.json({ clients });
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST – יצירת לקוח חדש
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, contactEmail, plan, notes, initialPolicy } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const org = createOrganization({
      name: name.trim(),
      contactEmail: contactEmail || "",
      plan: plan || "basic",
      notes: notes || "",
      status: "active",
      initialPolicy: initialPolicy || [],
    });

    // בניית הוראות חיבור מפורטות
    const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3000";
    const instructions = buildConnectionInstructions(serverUrl, org.apiKey);

    return NextResponse.json(
      {
        success: true,
        organization: { ...org, apiKey: undefined },
        apiKey: org.apiKey,
        organizationId: org.id,
        instructions,
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// DELETE – מחיקת לקוח
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("id");

    if (!orgId) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (orgId === "default-org") {
      return NextResponse.json({ error: "לא ניתן למחוק את ארגון ברירת המחדל" }, { status: 403 });
    }

    const deleted = deleteOrganization(orgId);
    if (!deleted) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

// ── בניית הוראות חיבור ──
function buildConnectionInstructions(serverUrl, apiKey) {
  return {
    browserExtension: [
      "התקן את התוסף DLP Shield מ-Chrome Web Store",
      `לחץ על אייקון המגן בסרגל הכלים`,
      `בשדה "כתובת שרת DLP" הכנס: ${serverUrl}`,
      "מפתח ה-API יוזן אוטומטית דרך מנהל המערכת",
    ],
    desktopShield: `# התקנה:\ncd dlp-server && npm install\n\n# הגדרת משתני סביבה:\nexport DLP_SERVER_URL="${serverUrl}"\nexport DLP_API_KEY="${apiKey}"\n\n# הפעלה:\nnpm run shield`,
    curlExample: `curl -X POST ${serverUrl}/api/check-text \\\n  -H "Content-Type: application/json" \\\n  -H "x-api-key: ${apiKey}" \\\n  -d '{"text": "הטקסט לבדיקה", "source": "api"}'`,
    sdkExample: `const response = await fetch('${serverUrl}/api/check-text', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json',\n    'x-api-key': '${apiKey}'\n  },\n  body: JSON.stringify({ text: 'הטקסט לבדיקה', source: 'sdk' })\n});\nconst result = await response.json();\n// result.safe → boolean\n// result.redactedText → טקסט מנוקה`,
  };
}
