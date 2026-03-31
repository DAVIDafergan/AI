"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Building2, ArrowLeft, Cpu, Activity, Terminal, Copy, CheckCheck,
  Server, Users, Plus, Loader2, Link, Shield,
} from "lucide-react";

function formatNum(n) { return (n ?? 0).toLocaleString("he-IL"); }

const STATUS_COLORS = {
  active:    "bg-green-500/20 text-green-400 border-green-700/40",
  trial:     "bg-blue-500/20 text-blue-400 border-blue-700/40",
  suspended: "bg-red-500/20 text-red-400 border-red-700/40",
  expired:   "bg-slate-500/20 text-slate-400 border-slate-700/40",
};

const SYNC_STATUS_LABELS = {
  active:   { label: "פעיל",   cls: "text-green-400"  },
  learning: { label: "לומד",   cls: "text-blue-400"   },
  offline:  { label: "מנותק",  cls: "text-red-400"    },
  error:    { label: "שגיאה",  cls: "text-red-400"    },
  paused:   { label: "מושהה",  cls: "text-yellow-400" },
};

const EVENT_LABELS = {
  scan:             "סריקה",
  block:            "חסימה",
  alert:            "התראה",
  agent_connect:    "חיבור סוכן",
  agent_disconnect: "ניתוק סוכן",
  config_change:    "שינוי הגדרות",
  user_action:      "פעולת משתמש",
};

function CopyButton({ text, label = "העתק" }) {
  const [state, setState] = useState("idle");
  function handleCopy() {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(
      () => { setState("copied"); setTimeout(() => setState("idle"), 2000); },
      () => {}
    );
  }
  return (
    <button onClick={handleCopy}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all ${
        state === "copied"
          ? "bg-green-500/20 text-green-400 border border-green-500/40"
          : "bg-slate-700/40 text-slate-400 border border-slate-600/40 hover:text-white hover:bg-slate-600/40"
      }`}>
      {state === "copied" ? <CheckCheck size={10} /> : <Copy size={10} />}
      {state === "copied" ? "הועתק" : label}
    </button>
  );
}

function ConnectionInstructions({ tenant, agents, superAdminKey, onAgentProvisioned }) {
  const serverUrl = process.env.NEXT_PUBLIC_DLP_SERVER_URL || "";
  const apiKey = tenant.apiKey || "";
  const primaryAgent = agents[0] || null;
  const [provName, setProvName] = useState("");
  const [provisioning, setProvisioning] = useState(false);
  const [provError, setProvError] = useState("");
  const [tab, setTab] = useState("server");

  const buildServerCmd = (agentKey) =>
    `npx ghostlayer-agent --server-url=${serverUrl || "<SERVER_URL>"} --api-key=${apiKey} --agent-key=${agentKey} --dir=/company/docs --verbose`;

  const buildDockerCmd = (agentKey) =>
    [
      "docker run -d \\",
      "  --name ghostlayer-agent \\",
      `  -e DLP_SERVER_URL=${serverUrl || "<SERVER_URL>"} \\`,
      `  -e DLP_TENANT_API_KEY=${apiKey} \\`,
      `  -e DLP_AGENT_KEY=${agentKey} \\`,
      "  ghostlayer/agent:latest",
    ].join("\n");

  const handleProvision = async () => {
    if (!provName.trim()) return;
    setProvisioning(true); setProvError("");
    try {
      const res = await fetch("/api/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-super-admin-key": superAdminKey },
        body: JSON.stringify({ tenantId: tenant._id, name: provName.trim(), environment: "production" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setProvName("");
      onAgentProvisioned?.();
    } catch (e) {
      setProvError(e.message);
    } finally {
      setProvisioning(false);
    }
  };

  const tabs = [
    { id: "server",    label: "חיבור שרת"      },
    { id: "shield",    label: "מגן עובדים"     },
    { id: "extension", label: "תוסף דפדפן"     },
  ];

  return (
    <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2 border-b border-slate-800">
        <Link size={14} className="text-cyan-400" />
        <span className="text-sm text-slate-300 font-medium">הוראות חיבור</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              tab === t.id ? "text-cyan-300 border-b-2 border-cyan-500 bg-cyan-500/5" : "text-slate-500 hover:text-slate-300"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-4">

        {/* ── שלב 1: חיבור שרת ── */}
        {tab === "server" && (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              הרץ פקודה זו על שרת החברה כדי לחבר את מנוע ה-AI שיסרוק את מסמכי הארגון.
            </p>

            {/* Provision new agent */}
            <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg p-3 space-y-2">
              <div className="text-xs text-slate-400 font-medium">יצירת סוכן חדש</div>
              <div className="flex gap-2">
                <input
                  value={provName}
                  onChange={(e) => setProvName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleProvision()}
                  placeholder="שם הסוכן (למשל: main-server)"
                  className="flex-1 bg-slate-900/60 border border-slate-700/60 rounded px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-600/60 font-mono"
                  dir="ltr"
                />
                <button onClick={handleProvision} disabled={!provName.trim() || provisioning}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/20 border border-cyan-600/40 rounded text-xs text-cyan-300 hover:bg-cyan-500/30 disabled:opacity-40 transition-colors">
                  {provisioning ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  צור סוכן
                </button>
              </div>
              {provError && <p className="text-xs text-red-400">{provError}</p>}
            </div>

            {/* Show commands for existing agents */}
            {agents.length === 0 ? (
              <p className="text-xs text-slate-600">צור סוכן ראשון למעלה כדי לקבל פקודות חיבור.</p>
            ) : agents.map((a) => {
              const cmd = buildServerCmd(a.agentKey);
              return (
                <div key={a._id} className="bg-slate-950 border border-slate-700/40 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-900/70 border-b border-slate-700/40">
                    <div className="flex items-center gap-1.5">
                      <Terminal size={11} className="text-slate-500" />
                      <span className="text-[10px] text-slate-400">{a.name}</span>
                    </div>
                    <CopyButton text={cmd} />
                  </div>
                  <div className="px-3 py-2.5 overflow-x-auto">
                    <code className="text-[11px] text-green-400 font-mono whitespace-pre">{cmd}</code>
                  </div>
                  <div className="px-3 pb-2 flex items-center gap-2">
                    <span className="text-[10px] text-slate-600">מפתח סוכן:</span>
                    <code className="text-[10px] text-cyan-400/70 font-mono">{a.agentKey}</code>
                    <CopyButton text={a.agentKey} />
                  </div>
                </div>
              );
            })}

            {/* API Key */}
            <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-700/40 rounded-lg px-3 py-2">
              <span className="text-[10px] text-slate-500">מפתח API של הדייר:</span>
              <code className="text-[10px] text-cyan-400 font-mono flex-1 truncate">{apiKey}</code>
              <CopyButton text={apiKey} />
            </div>
          </div>
        )}

        {/* ── שלב 2: מגן עובדים ── */}
        {tab === "shield" && (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              הרץ את הסקריפט על מחשבי העובדים (דרך Intune / Jamf) להתקנת מגן ה-DLP.
            </p>

            {[
              {
                title: "Windows – PowerShell / Intune",
                icon: "🪟",
                script: `# Windows (PowerShell / Intune)
$GL_KEY = "${apiKey}"
$GL_SERVER = "${serverUrl}"
Invoke-WebRequest -Uri "$GL_SERVER/downloads/GhostLayerShield.exe" -OutFile "$env:TEMP\\GhostLayerShield.exe"
Start-Process "$env:TEMP\\GhostLayerShield.exe" -ArgumentList "/S /KEY=$GL_KEY /SERVER=$GL_SERVER" -Wait`,
              },
              {
                title: "macOS – Bash / Jamf",
                icon: "🍎",
                script: `# macOS (Jamf / Terminal)
export GL_KEY="${apiKey}"
export GL_SERVER="${serverUrl}"
curl -fsSL "$GL_SERVER/downloads/GhostLayerShield.dmg" -o /tmp/GhostLayerShield.dmg
hdiutil attach /tmp/GhostLayerShield.dmg -nobrowse -quiet
sudo installer -pkg /Volumes/GhostLayerShield/GhostLayerShield.pkg -target /
hdiutil detach /Volumes/GhostLayerShield -quiet`,
              },
            ].map(({ title, icon, script }) => (
              <div key={title} className="bg-slate-950 border border-slate-700/40 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-slate-900/70 border-b border-slate-700/40">
                  <div className="flex items-center gap-1.5">
                    <span>{icon}</span>
                    <span className="text-[10px] text-slate-400">{title}</span>
                  </div>
                  <CopyButton text={script} />
                </div>
                <pre className="px-3 py-2.5 text-[10px] text-green-300 font-mono overflow-x-auto whitespace-pre">{script}</pre>
              </div>
            ))}
          </div>
        )}

        {/* ── שלב 3: תוסף דפדפן ── */}
        {tab === "extension" && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              התוסף מגן על פעילות הדפדפן — חוסם שיתוף מידע רגיש לאתרים חיצוניים.
            </p>
            <ol className="space-y-2">
              {[
                `הורד את תוסף Chrome מ: ${serverUrl}/extension/ghostlayer.crx`,
                "פתח Chrome → ניהול תוספים → מצב מפתח → גרור להתקנה",
                `בהגדרות התוסף, הכנס כתובת שרת: ${serverUrl}`,
                `הכנס מפתח API: ${apiKey}`,
                `לחץ "שמור והפעל" – ההגנה תתחיל מיד`,
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 text-[9px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-xs text-slate-300">{step}</span>
                </li>
              ))}
            </ol>
            <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500">מפתח API:</span>
                <code className="text-[10px] text-cyan-400 font-mono flex-1 truncate">{apiKey}</code>
                <CopyButton text={apiKey} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500">כתובת שרת:</span>
                <code className="text-[10px] text-cyan-400 font-mono flex-1 truncate">{serverUrl}</code>
                <CopyButton text={serverUrl} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TenantDetailView({ tenant, superAdminKey, onBack }) {
  const [agents, setAgents]   = useState([]);
  const [events, setEvents]   = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const [agentsRes, eventsRes] = await Promise.all([
        fetch(`/api/agents?tenantId=${tenant._id}`, {
          headers: { "x-super-admin-key": superAdminKey },
        }),
        fetch(`/api/tenant-events?tenantId=${tenant._id}&limit=25`, {
          headers: { "x-super-admin-key": superAdminKey },
        }),
      ]);
      if (agentsRes.ok) setAgents((await agentsRes.json()).agents || []);
      if (eventsRes.ok) setEvents((await eventsRes.json()).events || []);
    } finally {
      setLoading(false);
    }
  }, [tenant, superAdminKey]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (!tenant) return null;

  const connectedAgents = agents.filter((a) => a.syncStatus !== "offline").length;
  const totalBlocks = agents.reduce((sum, a) => sum + (a.metrics?.blocksExecuted || 0), 0);
  const totalScans  = agents.reduce((sum, a) => sum + (a.metrics?.scansPerformed  || 0), 0);

  const statusLabel = {
    active:    "פעיל",
    trial:     "ניסיון",
    suspended: "מושהה",
    expired:   "פג תוקף",
  };

  return (
    <div className="space-y-4">
      {/* כותרת + חזרה */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors">
          <ArrowLeft size={14} /> חזרה
        </button>
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-cyan-400" />
          <h2 className="text-base font-semibold text-slate-200">{tenant.name}</h2>
          <span className={`inline-block px-2 py-0.5 rounded border text-xs ${STATUS_COLORS[tenant.status] || STATUS_COLORS.trial}`}>
            {statusLabel[tenant.status] || tenant.status}
          </span>
        </div>
      </div>

      {/* נתוני שימוש */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ["סריקות כולל",         totalScans + (tenant.usage?.totalScans  ?? 0), "text-cyan-400"  ],
          ["חסימות כולל",         totalBlocks + (tenant.usage?.totalBlocks ?? 0), "text-red-400"   ],
          ["עובדים מחוברים",      connectedAgents,                               "text-green-400" ],
          ["סוכנים סה״כ",        agents.length,                                 "text-purple-400"],
        ].map(([label, value, color]) => (
          <div key={label} className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
            <div className="text-xs text-slate-500 mb-1">{label}</div>
            <div className={`text-2xl font-bold font-mono ${color}`}>{formatNum(value)}</div>
          </div>
        ))}
      </div>

      {/* הוראות חיבור */}
      <ConnectionInstructions
        tenant={tenant}
        agents={agents}
        superAdminKey={superAdminKey}
        onAgentProvisioned={fetchData}
      />

      {/* רשימת סוכנים */}
      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Cpu size={14} className="text-purple-400" />
            <span className="text-sm text-slate-300 font-medium">סוכנים פרוסים</span>
          </div>
          <span className="text-xs text-slate-600">{connectedAgents}/{agents.length} פעילים</span>
        </div>
        {loading ? (
          <p className="text-xs text-slate-600">טוען...</p>
        ) : agents.length === 0 ? (
          <p className="text-xs text-slate-600">אין סוכנים פרוסים עדיין — השתמש בהוראות החיבור למעלה</p>
        ) : (
          <div className="space-y-2">
            {agents.map((a) => {
              const st = SYNC_STATUS_LABELS[a.syncStatus] || { label: a.syncStatus, cls: "text-slate-400" };
              return (
                <div key={a._id} className="bg-slate-900/40 rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-200 font-medium">{a.name}</span>
                    <span className={`text-xs ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs text-slate-600">
                    <span>מסמכים: <span className="text-slate-400">{formatNum(a.metrics?.documentsIndexed)}</span></span>
                    <span>סריקות: <span className="text-slate-400">{formatNum(a.metrics?.scansPerformed)}</span></span>
                    <span>חסימות: <span className="text-slate-400">{formatNum(a.metrics?.blocksExecuted)}</span></span>
                    <span>תגובה:  <span className="text-slate-400">{a.metrics?.avgResponseTime ?? 0}ms</span></span>
                  </div>
                  {a.lastPing && (
                    <div className="text-[10px] text-slate-700">
                      פינג אחרון: {new Date(a.lastPing).toLocaleString("he-IL")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* אירועים אחרונים */}
      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={14} className="text-red-400" />
          <span className="text-sm text-slate-300 font-medium">אירועים אחרונים</span>
        </div>
        {loading ? (
          <p className="text-xs text-slate-600">טוען...</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-slate-600">אין אירועים</p>
        ) : (
          <div className="space-y-1">
            {events.map((e) => (
              <div key={e._id} className="flex items-center justify-between text-xs py-1 border-b border-slate-800/40">
                <span className="text-slate-300">{EVENT_LABELS[e.eventType] || e.eventType}</span>
                <span className={
                  e.severity === "critical" ? "text-red-400" :
                  e.severity === "high"     ? "text-orange-400" :
                  e.severity === "medium"   ? "text-yellow-400" : "text-slate-500"
                }>{e.severity}</span>
                {e.userEmail && <span className="text-slate-500 hidden sm:block truncate max-w-[120px]">{e.userEmail}</span>}
                <span className="text-slate-600 shrink-0">
                  {e.timestamp ? new Date(e.timestamp).toLocaleString("he-IL") : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* פרטי דייר */}
      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4 text-xs space-y-2 text-slate-400">
        <div>תוכנית: <span className="text-slate-200">{tenant.plan}</span></div>
        <div>איש קשר: <span className="text-slate-200">{tenant.contactEmail}</span></div>
        {tenant.contactName && <div>שם: <span className="text-slate-200">{tenant.contactName}</span></div>}
        {tenant.domain && <div>דומיין: <span className="text-slate-200">{tenant.domain}</span></div>}
        <div>נוצר: <span className="text-slate-200">{tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString("he-IL") : "—"}</span></div>
      </div>
    </div>
  );
}
