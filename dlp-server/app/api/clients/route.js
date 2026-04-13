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
    const clients = await getAllOrganizationsWithStats();
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

    const org = await createOrganization({
      name: name.trim(),
      contactEmail: contactEmail || "",
      plan: plan || "basic",
      notes: notes || "",
      status: "active",
      initialPolicy: initialPolicy || [],
    });

    // בניית הוראות חיבור מפורטות
    const serverUrl =
      process.env.DLP_SERVER_URL ||
      process.env.NEXT_PUBLIC_SERVER_URL ||
      new URL(request.url).origin;
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

    const deleted = await deleteOrganization(orgId);
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
  const agentCommand =
    `cd ghostlayer-local-agent && npm install && node index.js \\\n` +
    `  --api-key="${apiKey}" \\\n` +
    `  --server-url="${serverUrl}" \\\n` +
    `  --dir="/path/to/your/shared/drive" \\\n` +
    `  --local-port=4000 \\\n` +
    `  --verbose`;

  // Pre-configured extension bundle: a JSON object that employees can
  // import directly via chrome.storage.local or the extension Options page.
  // This eliminates manual copy-paste of keys during employee onboarding.
  const extensionBundle = JSON.stringify(
    {
      serverUrl,
      tenantApiKey: apiKey,
      localAgentUrl: "http://localhost:4000",
      enabled: true,
    },
    null,
    2
  );

  // Managed storage policy (for enterprise Chrome deployment via GPO / MDM)
  const managedStoragePolicy = JSON.stringify(
    {
      serverUrl,
      tenantApiKey: apiKey,
      localAgentUrl: "http://localhost:4000",
      enabled: true,
    },
    null,
    2
  );

  return {
    browserExtension: [
      "טען את dlp-extension כתוסף Unpacked דרך chrome://extensions (מצב מפתח)",
      `ב-Popup של התוסף הגדר "כתובת שרת DLP" ל: ${serverUrl}`,
      "פתח את Options של התוסף והגדר Local Agent URL ל-http://localhost:4000",
      `ב-Options הזן Tenant API Key: ${apiKey} ושמור`,
      "לחץ על בדיקת חיבור וודא שהסטטוס ירוק",
    ],
    // Pre-configured bundle: import this JSON via the extension Options page
    // or push via Chrome Enterprise Managed Storage to skip manual setup.
    extensionBundle,
    managedStoragePolicy,
    desktopShield: `# התקנה:\ncd dlp-server && npm install\n\n# הגדרת משתני סביבה:\nexport DLP_SERVER_URL="${serverUrl}"\nexport DLP_API_KEY="${apiKey}"\n\n# בדיקת חיבור שרת:\ncurl -s "${serverUrl}/api/health"\n\n# הפעלה:\nnpm run shield`,
    localAgent: agentCommand,
    curlExample: `curl -X POST ${serverUrl}/api/check-text \\\n  -H "Content-Type: application/json" \\\n  -H "x-api-key: ${apiKey}" \\\n  -d '{"text": "הטקסט לבדיקה", "source": "api"}'`,
    sdkExample: `const response = await fetch('${serverUrl}/api/check-text', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json',\n    'x-api-key': '${apiKey}'\n  },\n  body: JSON.stringify({ text: 'הטקסט לבדיקה', source: 'sdk' })\n});\nconst result = await response.json();\n// result.safe → boolean\n// result.redactedText → טקסט מנוקה`,
  };
}
