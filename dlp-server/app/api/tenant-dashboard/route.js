import { NextResponse } from "next/server";
import { connectMongo, Tenant, Agent, TenantEvent, findTenantByApiKey } from "../../../lib/db.js";

export const dynamic = "force-dynamic";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

// Severity levels that trigger the critical-leak red badge in the dashboard.
const CRITICAL_SEVERITIES = new Set(["critical", "high"]);

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

    const tenant = await findTenantByApiKey(apiKey);
    if (!tenant) {
      return NextResponse.json({ error: "מפתח API אינו תקין" }, { status: 401, headers: CORS_HEADERS });
    }

    const tenantId = tenant._id;
    const { origin } = new URL(request.url);
    const serverUrl = process.env.DLP_SERVER_URL || origin;
    const now = Date.now();

    // שלוף סוכנים, אירועים והיסטוריית חסימות במקביל
    const [agents, recentEvents, allBlockEvents, totalScans, blocksToday] = await Promise.all([
      Agent.find({ tenantId }).sort({ deployedAt: -1 }).lean(),

      TenantEvent.find({ tenantId })
        .sort({ timestamp: -1 })
        .limit(50)
        .lean(),

      TenantEvent.find(
        {
          tenantId,
          eventType: "block",
          // Limit to last 30 days to keep aggregation performant as data grows
          timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        { userEmail: 1, timestamp: 1, category: 1, severity: 1 }
      )
        .sort({ timestamp: -1 })
        .limit(1000)
        .lean(),

      TenantEvent.countDocuments({ tenantId, eventType: "scan" }),
      TenantEvent.countDocuments({
        tenantId,
        eventType: "block",
        timestamp: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      }),
    ]);

    const totalBlocks = await TenantEvent.countDocuments({ tenantId, eventType: "block" });

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

    // בנה סטטיסטיקות per-user מהאירועים
    const userMap = {};
    for (const ev of allBlockEvents) {
      const email = ev.userEmail || "anonymous@unknown.com";
      if (!userMap[email]) {
        userMap[email] = {
          email,
          replacements: 0,
          lastActivity: null,
          categories: {},
          criticalCount: 0,
          lastCriticalEvent: null,
        };
      }
      userMap[email].replacements += 1;
      const ts = ev.timestamp ? new Date(ev.timestamp).getTime() : 0;
      if (!userMap[email].lastActivity || ts > new Date(userMap[email].lastActivity).getTime()) {
        userMap[email].lastActivity = ev.timestamp;
      }
      if (ev.category) {
        userMap[email].categories[ev.category] = (userMap[email].categories[ev.category] || 0) + 1;
      }
      // Track high/critical severity events for the red-badge indicator
      if (ev.severity && CRITICAL_SEVERITIES.has(ev.severity)) {
        userMap[email].criticalCount += 1;
        if (
          !userMap[email].lastCriticalEvent ||
          ts > new Date(userMap[email].lastCriticalEvent.timestamp).getTime()
        ) {
          userMap[email].lastCriticalEvent = {
            timestamp: ev.timestamp,
            category:  ev.category,
            severity:  ev.severity,
          };
        }
      }
    }
    // סמן משתמשים שהיו פעילים ב-5 דקות האחרונות כ-"online"
    const userStats = Object.values(userMap).map((u) => {
      const lastMs = u.lastActivity ? new Date(u.lastActivity).getTime() : 0;
      return { ...u, online: lastMs > 0 && now - lastMs < 5 * 60 * 1000 };
    }).sort((a, b) => b.replacements - a.replacements);

    // בנה פקודת התקנת סוכן שרת (אם יש סוכן ראשון)
    const primaryAgent = enrichedAgents[0] || null;
    // Always build deployment config so the dashboard shows instructions
    // even before the first agent connects.
    const deploymentConfig = buildDeploymentConfig(serverUrl, apiKey);

    return NextResponse.json(
      {
        tenant: {
          id: tenantId,
          name: tenant.name,
          plan: tenant.plan,
          status: tenant.status,
          contactEmail: tenant.contactEmail,
          // Return the raw API key (from the request header) instead of the stored
          // hash so the dashboard can display it for copy-paste into agent configs.
          apiKey,
        },
        stats: {
          connectedAgents,
          totalAgents: enrichedAgents.length,
          totalBlocks: totalBlocks + (tenant.usage?.totalBlocks || 0),
          totalScans: totalScans + (tenant.usage?.totalScans || 0),
          blocksToday,
          monthlyQuota: tenant.usage?.monthlyQuota || 10000,
          monthlyScans: tenant.usage?.monthlyScans || 0,
          totalUsers: userStats.length,
          onlineUsers: userStats.filter((u) => u.online).length,
        },
        agents: enrichedAgents,
        recentEvents: recentEvents.slice(0, 30),
        userStats,
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

function buildDeploymentConfig(serverUrl, apiKey) {
  const safeServer = sanitizeForShell(serverUrl);
  const safeApiKey = sanitizeForShell(apiKey);

  const serverCommand = [
    "cd ghostlayer-local-agent || exit 1; npm install && node index.js \\",
    `  --api-key=${safeApiKey} \\`,
    `  --server-url=${safeServer} \\`,
    "  --dir=/company/docs \\",
    "  --local-port=4000 \\",
    "  --verbose",
  ].join("\n");

  const dockerCommand = [
    "cd ghostlayer-local-agent || exit 1; cp -n .env.template .env && \\",
    `printf "API_KEY=${safeApiKey}\\nSERVER_URL=${safeServer}\\nLOCAL_PORT=4000\\nVERBOSE=true\\n" > .env && \\`,
    "mkdir -p corporate_data && docker compose up -d --build",
  ].join("\n");

  const windowsShield = `# Windows (PowerShell / Intune)\n$GL_KEY = "${safeApiKey}"\n$GL_SERVER = "${safeServer}"\nInvoke-WebRequest -Uri "$GL_SERVER/downloads/GhostLayerShield.exe" -OutFile "$env:TEMP\\GhostLayerShield.exe"\nStart-Process "$env:TEMP\\GhostLayerShield.exe" -ArgumentList "/S /KEY=$GL_KEY /SERVER=$GL_SERVER" -Wait`;

  const macShield = `# macOS (Jamf / Terminal)\nexport GL_KEY="${safeApiKey}"\nexport GL_SERVER="${safeServer}"\ncurl -fsSL "$GL_SERVER/downloads/GhostLayerShield.dmg" -o /tmp/GhostLayerShield.dmg\nhdiutil attach /tmp/GhostLayerShield.dmg -nobrowse -quiet\nsudo installer -pkg /Volumes/GhostLayerShield/GhostLayerShield.pkg -target / \nhdiutil detach /Volumes/GhostLayerShield -quiet`;

  const extensionInstructions = [
    "טען את dlp-extension כתוסף Unpacked דרך chrome://extensions (מצב מפתח)",
    `ב-Popup של התוסף הגדר "כתובת שרת DLP" ל: ${safeServer}`,
    'ב-Options של התוסף הגדר "Local Agent URL" ל: http://localhost:4000',
    `ב-Options הזן "Tenant API Key": ${safeApiKey} ושמור`,
    "לחץ על כפתור בדיקת חיבור וודא שמתקבל סטטוס ירוק",
  ];

  return { serverCommand, dockerCommand, windowsShield, macShield, extensionInstructions };
}
