import { NextResponse } from "next/server";
import { connectMongo, Tenant, Agent, TenantEvent } from "../../../lib/db.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// GET /api/tenant-dashboard – נתוני דשבורד לדייר מאומת עם apiKey
export async function GET(request) {
  try {
    const apiKey = request.headers.get("x-api-key");
    if (!apiKey) {
      return NextResponse.json({ error: "נדרש מפתח API" }, { status: 401, headers: CORS_HEADERS });
    }

    await connectMongo();

    const tenant = await Tenant.findOne({ apiKey }).lean();
    if (!tenant) {
      return NextResponse.json({ error: "מפתח API אינו תקין" }, { status: 401, headers: CORS_HEADERS });
    }

    const tenantId = tenant._id;
    const { origin } = new URL(request.url);
    const serverUrl = process.env.DLP_SERVER_URL || origin;
    const now = Date.now();

    // שלוף סוכנים, אירועים והיסטוריית חסימות במקביל
    const [agents, recentEvents, totalBlocks, totalScans, blocksToday] = await Promise.all([
      Agent.find({ tenantId }).sort({ deployedAt: -1 }).lean(),

      TenantEvent.find({ tenantId })
        .sort({ timestamp: -1 })
        .limit(30)
        .lean(),

      TenantEvent.countDocuments({ tenantId, eventType: "block" }),
      TenantEvent.countDocuments({ tenantId, eventType: "scan" }),
      TenantEvent.countDocuments({
        tenantId,
        eventType: "block",
        timestamp: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      }),
    ]);

    // הוסף סטטוס דינמי לכל סוכן
    const enrichedAgents = agents.map((a) => {
      let syncStatus = a.syncStatus;
      if (a.lastPing) {
        const diff = now - new Date(a.lastPing).getTime();
        if (diff > 120000) syncStatus = "offline";
        else if ((a.metrics?.documentsIndexed || 0) === 0) syncStatus = "learning";
        else syncStatus = "active";
      }
      return { ...a, syncStatus };
    });

    const connectedAgents = enrichedAgents.filter((a) => a.syncStatus !== "offline").length;

    // בנה פקודת התקנת סוכן שרת (אם יש סוכן ראשון)
    const primaryAgent = enrichedAgents[0] || null;
    const deploymentConfig = primaryAgent
      ? buildDeploymentConfig(serverUrl, tenant.apiKey, primaryAgent.agentKey)
      : null;

    return NextResponse.json(
      {
        tenant: {
          id: tenantId,
          name: tenant.name,
          plan: tenant.plan,
          status: tenant.status,
          contactEmail: tenant.contactEmail,
          apiKey: tenant.apiKey,
        },
        stats: {
          connectedAgents,
          totalAgents: enrichedAgents.length,
          totalBlocks: totalBlocks + (tenant.usage?.totalBlocks || 0),
          totalScans: totalScans + (tenant.usage?.totalScans || 0),
          blocksToday,
          monthlyQuota: tenant.usage?.monthlyQuota || 10000,
          monthlyScans: tenant.usage?.monthlyScans || 0,
        },
        agents: enrichedAgents,
        recentEvents,
        serverUrl,
        deploymentConfig,
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}

function sanitizeForShell(value) {
  // Strip any characters that could break shell command context
  return String(value).replace(/[^a-zA-Z0-9_\-:.\/]/g, "");
}

function buildDeploymentConfig(serverUrl, apiKey, agentKey) {
  const safeServer = sanitizeForShell(serverUrl);
  const safeApiKey = sanitizeForShell(apiKey);
  const safeAgentKey = sanitizeForShell(agentKey);

  const serverCommand = `npx ghostlayer-agent \\\n  --server-url=${safeServer} \\\n  --api-key=${safeApiKey} \\\n  --agent-key=${safeAgentKey} \\\n  --dir=/company/docs \\\n  --verbose`;

  const dockerCommand = [
    "docker run -d \\",
    "  --name ghostlayer-agent \\",
    `  -e DLP_SERVER_URL=${safeServer} \\`,
    `  -e DLP_TENANT_API_KEY=${safeApiKey} \\`,
    `  -e DLP_AGENT_KEY=${safeAgentKey} \\`,
    "  -e DLP_ENVIRONMENT=production \\",
    "  ghostlayer/agent:latest",
  ].join("\n");

  const windowsShield = `# Windows (PowerShell / Intune)\n$GL_KEY = "${safeApiKey}"\n$GL_SERVER = "${safeServer}"\nInvoke-WebRequest -Uri "$GL_SERVER/downloads/GhostLayerShield.exe" -OutFile "$env:TEMP\\GhostLayerShield.exe"\nStart-Process "$env:TEMP\\GhostLayerShield.exe" -ArgumentList "/S /KEY=$GL_KEY /SERVER=$GL_SERVER" -Wait`;

  const macShield = `# macOS (Jamf / Terminal)\nexport GL_KEY="${safeApiKey}"\nexport GL_SERVER="${safeServer}"\ncurl -fsSL "$GL_SERVER/downloads/GhostLayerShield.dmg" -o /tmp/GhostLayerShield.dmg\nhdiutil attach /tmp/GhostLayerShield.dmg -nobrowse -quiet\nsudo installer -pkg /Volumes/GhostLayerShield/GhostLayerShield.pkg -target / \nhdiutil detach /Volumes/GhostLayerShield -quiet`;

  const extensionInstructions = [
    `הורד את תוסף Chrome מ: ${safeServer}/extension/ghostlayer.crx`,
    `בשדה "כתובת שרת DLP" הכנס: ${safeServer}`,
    `בשדה "מפתח API" הכנס: ${safeApiKey}`,
    `לחץ "שמור והפעל" – הגנה תתחיל מיד`,
  ];

  return { serverCommand, dockerCommand, windowsShield, macShield, extensionInstructions };
}
