"use client";

/**
 * app/admin/page.js
 *
 * GHOST – מרכז ניהול לקוח
 * שלב 1: חיבור סוכן השרת
 * שלב 2: פריסת מגני עובדים
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Brain, Cpu, Server, Download, Copy, CheckCheck,
  Activity, Users, Zap, Lock, Eye, ChevronRight, Shield,
  Terminal, AlertCircle, Wifi, RefreshCw, UserCheck, Replace,
  TrendingUp, Clock, Filter, Search, ChevronDown, ChevronUp,
  AlertTriangle, X, LogOut, Building2, ShieldAlert,
} from "lucide-react";
import ActiveUsersPanel from "./components/ActiveUsersPanel";
import CustomKeywordsManager from "./components/CustomKeywordsManager";
import GhostLogo from "../../components/GhostLogo";

function clsx(...cls) { return cls.filter(Boolean).join(" "); }
function formatNum(n) { return (n ?? 0).toLocaleString("he-IL"); }
const TENANT_DASHBOARD_API_PATH = "/api/tenant-dashboard";
const ADMIN_API_KEY_STORAGE_KEYS = ["ghostlayer_admin_key", "tenantApiKey", "ghostlayer_api_key"];

function readStoredApiKey() {
  if (typeof window === "undefined") return "";
  for (const key of ADMIN_API_KEY_STORAGE_KEYS) {
    const fromLocal = localStorage.getItem(key)?.trim();
    if (fromLocal) return fromLocal;
    const fromSession = sessionStorage.getItem(key)?.trim();
    if (fromSession) return fromSession;
  }
  return "";
}

function readEnvApiKey() {
  return (
    process.env.NEXT_PUBLIC_TENANT_API_KEY ||
    process.env.NEXT_PUBLIC_DLP_API_KEY ||
    process.env.NEXT_PUBLIC_API_KEY ||
    ""
  ).trim();
}

function resolveTenantApiKey(preferred = "") {
  return preferred?.trim() || readStoredApiKey() || readEnvApiKey();
}

function persistTenantApiKey(key) {
  if (typeof window === "undefined") return;
  const clean = key?.trim();
  if (!clean) return;
  try { localStorage.setItem("ghostlayer_admin_key", clean); } catch {}
  try { sessionStorage.setItem("ghostlayer_admin_key", clean); } catch {}
}

function clearPersistedTenantApiKey() {
  if (typeof window === "undefined") return;
  for (const key of ADMIN_API_KEY_STORAGE_KEYS) {
    try { localStorage.removeItem(key); } catch {}
    try { sessionStorage.removeItem(key); } catch {}
  }
}

function LiveDot({ color = "bg-green-500" }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className={clsx("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", color)} />
      <span className={clsx("relative inline-flex rounded-full h-2.5 w-2.5", color)} />
    </span>
  );
}

function CopyButton({ text, label = "העתק" }) {
  const [state, setState] = useState("idle");
  function handleCopy() {
    if (!navigator.clipboard) { setState("error"); setTimeout(() => setState("idle"), 2500); return; }
    navigator.clipboard.writeText(text).then(
      () => { setState("copied"); setTimeout(() => setState("idle"), 2000); },
      () => { setState("error"); setTimeout(() => setState("idle"), 2500); }
    );
  }
  const styles = {
    idle  : "bg-slate-700/60 text-slate-300 border border-slate-600/50 hover:bg-slate-600/60 hover:text-white",
    copied: "bg-green-500/20 text-green-400 border border-green-500/40",
    error : "bg-rose-500/20 text-rose-400 border border-rose-500/40",
  };
  return (
    <button onClick={handleCopy}
      className={clsx("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200", styles[state])}>
      {state === "copied" ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {state === "copied" ? "הועתק!" : state === "error" ? "שגיאה" : label}
    </button>
  );
}

function MetricCard({ icon: Icon, label, value, sub, color = "text-cyan-400", border = "border-cyan-500/20" }) {
  return (
    <div className={clsx("bg-slate-900/60 border rounded-xl p-4 flex items-start gap-3", border)}>
      <div className="p-2 rounded-lg bg-slate-800/80"><Icon className={clsx("w-4 h-4", color)} /></div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 truncate">{label}</p>
        <p className={clsx("text-lg font-bold mt-0.5", color)}>{value}</p>
        {sub && <p className="text-xs text-slate-600 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

function AgentIntelligencePanel({ agents = [] }) {
  const connected = agents.filter((a) => a.syncStatus !== "offline");
  const active    = agents.filter((a) => a.syncStatus === "active");
  const learning  = agents.filter((a) => a.syncStatus === "learning");

  // Aggregate brain summaries across all agents
  const totals = agents.reduce(
    (acc, a) => {
      const b = a.brainSummary || {};
      return {
        persons:  acc.persons  + (b.personsFound || 0),
        orgs:     acc.orgs     + (b.orgsFound    || 0),
        pii:      acc.pii      + (b.piiFound     || 0),
        docs:     acc.docs     + (a.metrics?.documentsIndexed || 0),
        highSens: acc.highSens + (b.highlySensitiveFiles || 0),
      };
    },
    { persons: 0, orgs: 0, pii: 0, docs: 0, highSens: 0 }
  );

  const allTopOrgs = [...new Set(
    agents.flatMap((a) => a.brainSummary?.topOrgs || [])
  )].slice(0, 12);

  const allTopPersons = [...new Set(
    agents.flatMap((a) => a.brainSummary?.topPersons || [])
  )].slice(0, 12);

  const hasBrain = totals.persons + totals.orgs + totals.pii > 0;
  const isLearning = learning.length > 0 && !hasBrain;

  if (agents.length === 0) return null;

  return (
    <div className="bg-slate-900/40 border border-cyan-500/15 rounded-2xl p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-cyan-500/10 rounded-xl border border-cyan-500/20">
          <Brain className="w-6 h-6 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">מה הסוכן למד על הארגון</h2>
          <p className="text-sm text-slate-400">ממצאי מנוע ה-AI המקומי — אינדוקס מסמכים ומידע רגיש</p>
        </div>
        <div className="mr-auto flex items-center gap-2">
          {active.length > 0
            ? <><span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"/><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-400"/></span><span className="text-xs text-cyan-400 font-medium">מנוע AI פעיל</span></>
            : isLearning
              ? <><span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"/><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-400"/></span><span className="text-xs text-blue-400 font-medium">לומד...</span></>
              : <span className="text-xs text-slate-500">ממתין לסריקה</span>
          }
        </div>
      </div>

      {isLearning ? (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-5 flex items-center gap-4">
          <Brain className="w-8 h-8 text-blue-400 animate-pulse shrink-0" />
          <div>
            <p className="text-sm font-semibold text-blue-300">הסוכן סורק את הכונן הארגוני...</p>
            <p className="text-xs text-slate-400 mt-1">
              מנוע ה-AI המקומי לומד את תוכן המסמכים. הנתונים יופיעו כאן בסיום הסריקה הראשונה.
            </p>
          </div>
        </div>
      ) : !hasBrain ? (
        <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-5 text-center space-y-2">
          <Brain className="w-8 h-8 text-slate-700 mx-auto" />
          <p className="text-sm text-slate-500">הסוכן טרם דיווח על ממצאי סריקה</p>
          <p className="text-xs text-slate-600">הרץ את הסוכן עם הפרמטר <code className="text-cyan-500/70">--dir</code> כדי לאנדקס את הכונן הארגוני</p>
        </div>
      ) : (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: Cpu,          label: "מסמכים אינדקסו",     value: totals.docs.toLocaleString("he-IL"),    color: "text-cyan-400",   border: "border-cyan-500/20"   },
              { icon: Building2,    label: "ארגונים / לקוחות",   value: totals.orgs,                            color: "text-purple-400", border: "border-purple-500/20" },
              { icon: Users,        label: "אנשים שזוהו",        value: totals.persons,                         color: "text-blue-400",   border: "border-blue-500/20"   },
              { icon: ShieldAlert,  label: "רשומות PII שנמצאו",  value: totals.pii,                             color: "text-red-400",    border: "border-red-500/20"    },
            ].map(({ icon: Icon, label, value, color, border }) => (
              <MetricCard key={label} icon={Icon} label={label} value={value} color={color} border={border} />
            ))}
          </div>

          {/* Highly sensitive indicator */}
          {totals.highSens > 0 && (
            <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-sm text-red-300">
                <strong>{totals.highSens}</strong> קבצים עם רמת רגישות גבוהה מאוד זוהו בכונן הארגוני
              </p>
            </div>
          )}

          {/* Discovered orgs */}
          {allTopOrgs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-3 h-3" /> ארגונים ולקוחות שזוהו בתוכן
              </p>
              <div className="flex flex-wrap gap-2">
                {allTopOrgs.map((org) => (
                  <span key={org} className="bg-purple-500/10 border border-purple-500/25 text-purple-300 text-xs px-3 py-1 rounded-full">
                    {org}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Discovered persons */}
          {allTopPersons.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3 h-3" /> אנשים שזוהו בתוכן
              </p>
              <div className="flex flex-wrap gap-2">
                {allTopPersons.map((person) => (
                  <span key={person} className="bg-blue-500/10 border border-blue-500/25 text-blue-300 text-xs px-3 py-1 rounded-full">
                    {person}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ServerBrainPhase({ data }) {
  const agents = data?.agents || [];
  const cfg = data?.deploymentConfig;
  const apiKey = data?.tenant?.apiKey || "";
  const serverUrl = data?.serverUrl || "";
  const activeAgent = agents.find((a) => a.syncStatus === "active" || a.syncStatus === "learning");
  const connected = !!activeAgent;
  const [tab, setTab] = useState("node");
  const [connTestState, setConnTestState] = useState("idle"); // idle | testing | ok | error
  const [connTestMsg, setConnTestMsg] = useState("");

  const command = cfg?.serverCommand ||
    `cd ghostlayer-local-agent || exit 1; npm install && node index.js \\\n  --api-key=${apiKey} \\\n  --server-url=${serverUrl} \\\n  --dir=/company/docs \\\n  --local-port=4000 \\\n  --verbose`;
  const dockerCmd = cfg?.dockerCommand ||
    `cd ghostlayer-local-agent || exit 1; cp -n .env.template .env && \\\nprintf "API_KEY=${apiKey}\\nSERVER_URL=${serverUrl}\\nLOCAL_PORT=4000\\nVERBOSE=true\\n" > .env && \\\nmkdir -p corporate_data && docker compose up -d --build`;

  const layerStatus = connected
    ? {
        l1: "active",
        l2: (activeAgent.metrics?.documentsIndexed || 0) > 0 ? "active" : "idle",
        l3: (activeAgent.metrics?.vectorsStored || 0) > 0 ? "active" : "idle",
      }
    : { l1: "idle", l2: "idle", l3: "idle" };

  const layerColor = (s) =>
    s === "active"
      ? "bg-green-500/20 text-green-400 border-green-500/30"
      : "bg-slate-800/50 text-slate-600 border-slate-700/30";

  const CONNECTION_TIMEOUT_MS = 6000;

  const testConnection = async () => {
    setConnTestState("testing");
    setConnTestMsg("בודק חיבור לשרת...");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
      const res = await fetch(`${serverUrl}/api/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const d = await res.json();
        setConnTestState("ok");
        setConnTestMsg(`✅ השרת פעיל (גרסה ${d.version || "?"}, ${d.uptime || 0}s uptime)`);
      } else {
        setConnTestState("error");
        setConnTestMsg(`❌ השרת החזיר שגיאה (HTTP ${res.status})`);
      }
    } catch {
      setConnTestState("error");
      setConnTestMsg("❌ לא ניתן להתחבר לשרת – ודא שכתובת ה-URL נכונה");
    }
  };

  // ── Step-by-step guide for connecting the agent ──
  const steps = [
    { num: 1, text: "שכפל את הריפו או העתק את תיקיית ghostlayer-local-agent לשרת החברה", icon: "📥" },
    { num: 2, text: `העתק את מפתח ה-API: ${apiKey.slice(0, 12)}...`, icon: "🔑" },
    { num: 3, text: "הרץ את הפקודה למטה על שרת החברה (Node.js או Docker)", icon: "▶️" },
    { num: 4, text: "לחץ על \"בדוק חיבור\" לוודא שהסוכן מחובר לשרת", icon: "🔌" },
  ];

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-cyan-500/10 rounded-xl border border-cyan-500/20">
          <Server className="w-6 h-6 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">שלב 1 — חיבור מוח השרת</h2>
          <p className="text-sm text-slate-400">הרץ פקודה אחת על שרת החברה להפעלת מנוע ה-AI</p>
        </div>
        <div className="mr-auto flex items-center gap-2">
          {connected
            ? <><LiveDot color="bg-green-500" /><span className="text-xs text-green-400 font-medium">סוכן מחובר</span></>
            : <><LiveDot color="bg-yellow-500" /><span className="text-xs text-yellow-400 font-medium">ממתין לסוכן...</span></>}
        </div>
      </div>

      {/* Quick guide steps */}
      <div className="bg-slate-900/60 border border-slate-700/40 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">מדריך חיבור מהיר</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {steps.map(({ num, text, icon }) => (
            <div key={num} className={clsx(
              "flex items-start gap-3 rounded-xl border px-4 py-3 transition-all",
              num === 4 && connected ? "bg-green-500/10 border-green-500/30" : "bg-slate-800/40 border-slate-700/30"
            )}>
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 text-xs font-bold flex items-center justify-center mt-0.5">
                {num <= 3 || !connected ? num : "✓"}
              </span>
              <div>
                <span className="text-xs text-slate-300 leading-relaxed">{text}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-900/60 rounded-xl p-1 border border-slate-700/40 w-fit">
        {[["node","Node.js (מומלץ)"],["docker","Docker"]].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={clsx("py-1.5 px-4 rounded-lg text-xs font-medium transition-all",
              tab === id ? "bg-cyan-600/25 text-cyan-300 border border-cyan-500/30" : "text-slate-500 hover:text-slate-300")}>
            {label}
          </button>
        ))}
      </div>

      {/* Command block */}
      <div className="bg-slate-950 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/80 border-b border-slate-700/50">
          <div className="flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs text-slate-500 font-medium">הרץ על שרת החברה</span>
          </div>
          <CopyButton text={tab === "node" ? command : dockerCmd} label="העתק פקודה" />
        </div>
        <div className="px-5 py-4 overflow-x-auto">
          <code className="text-sm text-green-400 font-mono whitespace-pre">
            <span className="text-slate-600 select-none">$ </span>
            {tab === "node" ? command : dockerCmd}
          </code>
        </div>
        <div className="px-5 pb-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-600">מפתח API של הדייר:</span>
          <code className="text-xs text-cyan-400 font-mono bg-slate-800/60 px-2 py-0.5 rounded">{apiKey}</code>
          <CopyButton text={apiKey} label="העתק מפתח" />
        </div>
      </div>

      {/* Connection test */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={testConnection}
          disabled={connTestState === "testing"}
          className={clsx(
            "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border",
            connTestState === "testing"
              ? "bg-slate-700 border-slate-600 text-slate-400 cursor-wait"
              : connTestState === "ok"
                ? "bg-green-500/15 border-green-500/40 text-green-400 hover:bg-green-500/25"
                : connTestState === "error"
                  ? "bg-red-500/15 border-red-500/40 text-red-400 hover:bg-red-500/25"
                  : "bg-cyan-500/15 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/25"
          )}
        >
          {connTestState === "testing"
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : connTestState === "ok"
              ? <CheckCheck className="w-4 h-4" />
              : <Wifi className="w-4 h-4" />}
          {connTestState === "testing" ? "בודק..." : "בדוק חיבור לשרת"}
        </button>
        {connTestMsg && (
          <span className={clsx("text-xs font-medium",
            connTestState === "ok" ? "text-green-400" : connTestState === "error" ? "text-red-400" : "text-slate-400"
          )}>
            {connTestMsg}
          </span>
        )}
      </div>

      {/* Detection layers */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { id: "l1", label: "L1 – פילטר Bloom", sub: "< 1ms",        icon: Zap   },
          { id: "l2", label: "L2 – זיהוי PII",   sub: "< 5ms",        icon: Eye   },
          { id: "l3", label: "L3 – RAG סמנטי",   sub: "אסינכרוני",    icon: Brain },
        ].map(({ id, label, sub, icon: Icon }) => (
          <div key={id} className={clsx("flex items-center gap-2.5 rounded-xl border px-4 py-3 transition-all duration-500", layerColor(layerStatus[id]))}>
            <Icon className="w-4 h-4 shrink-0" />
            <div>
              <p className="text-xs font-semibold">{label}</p>
              <p className="text-[10px] opacity-60">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Active agents */}
      {agents.length > 0 && (
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold text-white">סוכנים פעילים</span>
            {connected && <LiveDot color="bg-cyan-500" />}
          </div>
          <div className="space-y-3">
            {agents.map((a) => (
              <div key={a._id} className="bg-slate-800/40 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-200">{a.name}</span>
                  <span className={clsx("text-xs px-2 py-0.5 rounded-full border",
                    a.syncStatus === "active"   ? "bg-green-500/20 text-green-400 border-green-500/30" :
                    a.syncStatus === "learning" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
                    "bg-slate-700/40 text-slate-500 border-slate-600/30")}>
                    {a.syncStatus === "active" ? "פעיל" : a.syncStatus === "learning" ? "לומד" : "מנותק"}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-500">
                  <span>מסמכים: <span className="text-slate-300 font-mono">{formatNum(a.metrics?.documentsIndexed)}</span></span>
                  <span>וקטורים: <span className="text-slate-300 font-mono">{formatNum(a.metrics?.vectorsStored)}</span></span>
                  <span>סריקות: <span className="text-slate-300 font-mono">{formatNum(a.metrics?.scansPerformed)}</span></span>
                  <span>חסימות: <span className="text-slate-300 font-mono">{formatNum(a.metrics?.blocksExecuted)}</span></span>
                </div>
                {a.lastPing && (
                  <div className="text-[10px] text-slate-600">
                    פינג אחרון: {new Date(a.lastPing).toLocaleString("he-IL")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {connected && (
        <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-2.5">
          <Shield className="w-4 h-4 text-green-400" />
          <span className="text-sm text-green-300 font-medium">מנוע ה-RAG פעיל — מנגנון Ghost-Masking מוכן</span>
        </div>
      )}
    </section>
  );
}

function WorkerShieldPhase({ data }) {
  const cfg = data?.deploymentConfig;
  const agents = data?.agents || [];
  const apiKey = data?.tenant?.apiKey || "";
  const serverUrl = data?.serverUrl || "";
  const [activeTab, setActiveTab] = useState("downloads");

  const windowsScript = cfg?.windowsShield ||
    `# Windows (PowerShell / Intune)
$GL_KEY = "${apiKey}"
$GL_SERVER = "${serverUrl}"
Invoke-WebRequest -Uri "$GL_SERVER/downloads/GhostLayerShield.exe" -OutFile "$env:TEMP\\GhostLayerShield.exe"
Start-Process "$env:TEMP\\GhostLayerShield.exe" -ArgumentList "/S /KEY=$GL_KEY /SERVER=$GL_SERVER" -Wait`;

  const macScript = cfg?.macShield ||
    `# macOS (Jamf / Terminal)
export GL_KEY="${apiKey}"
export GL_SERVER="${serverUrl}"
curl -fsSL "$GL_SERVER/downloads/GhostLayerShield.dmg" -o /tmp/GhostLayerShield.dmg
hdiutil attach /tmp/GhostLayerShield.dmg -nobrowse -quiet
sudo installer -pkg /Volumes/GhostLayerShield/GhostLayerShield.pkg -target /
hdiutil detach /Volumes/GhostLayerShield -quiet`;

  const extensionSteps = cfg?.extensionInstructions || [
    "טען את dlp-extension כתוסף Unpacked דרך chrome://extensions (מצב מפתח)",
    `ב-Popup של התוסף הגדר "כתובת שרת DLP" ל: ${serverUrl}`,
    'ב-Options של התוסף הגדר "Local Agent URL" ל: http://localhost:4000',
    `ב-Options הזן "Tenant API Key": ${apiKey}`,
    "שמור ובצע בדיקת חיבור עד שהסטטוס ירוק",
  ];

  const downloads = [
    { label: "מגן Windows", ext: ".exe", icon: "🪟", color: "bg-blue-500/10 border-blue-500/25 text-blue-400",       size: "18.4 MB" },
    { label: "מגן macOS",   ext: ".dmg", icon: "🍎", color: "bg-slate-700/30 border-slate-600/40 text-slate-300",    size: "21.1 MB" },
    { label: "תוסף Chrome", ext: ".crx", icon: "🌐", color: "bg-yellow-500/10 border-yellow-500/25 text-yellow-400", size: "3.2 MB"  },
  ];

  const activeCount = agents.filter((a) => a.syncStatus !== "offline").length;

  const tabs = [
    { id: "downloads",   label: "הורדות"                              },
    { id: "mass-deploy", label: "פריסה המונית"                        },
    { id: "extension",   label: "תוסף דפדפן"                          },
    { id: "fleet",       label: `מעקב ציי (${activeCount} פעילים)`   },
  ];

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-purple-500/10 rounded-xl border border-purple-500/20">
          <Users className="w-6 h-6 text-purple-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">שלב 2 — פריסת מגני עובדים</h2>
          <p className="text-sm text-slate-400">הגן על כל נקודת קצה של עובד תוך דקות</p>
        </div>
        <div className="mr-auto flex items-center gap-2">
          <LiveDot color="bg-purple-500" />
          <span className="text-xs text-purple-400 font-medium">{activeCount} מגנים פעילים</span>
        </div>
      </div>

      <div className="flex gap-1 bg-slate-900/60 rounded-xl p-1 border border-slate-700/40 flex-wrap">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={clsx("flex-1 min-w-fit py-2 px-3 rounded-lg text-xs font-medium transition-all duration-200",
              activeTab === t.id
                ? "bg-purple-600/25 text-purple-300 border border-purple-500/30"
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50")}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "downloads" && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            לחץ להורדת תוכנת המגן לכל פלטפורמה. הרץ את ההתקנה על מחשב העובד — היא תירשם אוטומטית עם מפתח הדייר שלך.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {downloads.map(({ label, ext, icon, color, size }) => (
              <a key={ext} href={`${serverUrl}/downloads/GhostLayerShield${ext}`}
                className={clsx("flex flex-col items-center gap-3 rounded-xl border px-4 py-6 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/30 active:scale-100 cursor-pointer", color)}>
                <span className="text-4xl">{icon}</span>
                <div className="text-center">
                  <p className="font-semibold text-sm">{label}</p>
                  <p className="text-[11px] opacity-60 mt-0.5">{size} · {ext}</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium mt-1">
                  <Download className="w-3.5 h-3.5" /> הורד
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {activeTab === "mass-deploy" && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            העתק את הסקריפט המתאים והדבק אותו ב-<strong className="text-white">Intune (Windows)</strong> או{" "}
            <strong className="text-white">Jamf (macOS)</strong> לפריסה שקטה בכל הציי.
          </p>
          {[
            { title: "Windows – PowerShell / Intune", script: windowsScript, icon: "🪟" },
            { title: "macOS – Bash / Jamf",           script: macScript,     icon: "🍎" },
          ].map(({ title, script, icon }) => (
            <div key={title} className="bg-slate-950 border border-slate-700/50 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/80 border-b border-slate-700/50">
                <div className="flex items-center gap-2">
                  <span>{icon}</span>
                  <span className="text-xs text-slate-500 font-medium">{title}</span>
                </div>
                <CopyButton text={script} label="העתק סקריפט" />
              </div>
              <pre className="px-5 py-4 text-xs text-green-300 font-mono overflow-x-auto leading-relaxed whitespace-pre">{script}</pre>
            </div>
          ))}
        </div>
      )}

      {activeTab === "extension" && (
        <div className="space-y-5">
          <p className="text-sm text-slate-400">
            התוסף מגן על פעילות הדפדפן — מזהה ומסווה מידע רגיש בזמן אמת בעת הדבקה והקלדה בצ'אטים ואתרי AI.
          </p>

          {/* Visual step-by-step cards */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-semibold text-white">שלבי הגדרה</span>
            </div>
            {extensionSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-3 bg-slate-800/40 border border-slate-700/30 rounded-xl px-4 py-3">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-400 text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                <span className="text-sm text-slate-300 leading-relaxed">{step}</span>
              </div>
            ))}
          </div>

          {/* Copy-ready credentials */}
          <div className="bg-slate-900/60 border border-slate-700/40 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Lock className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-semibold text-white">פרטי חיבור (העתק והדבק בתוסף)</span>
            </div>
            <div className="space-y-3">
              <div className="bg-slate-800/60 border border-slate-700/30 rounded-lg p-3">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">מפתח API</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-sm text-cyan-400 font-mono bg-slate-900/60 px-3 py-1.5 rounded border border-slate-700/40 flex-1 min-w-0 truncate">{apiKey}</code>
                  <CopyButton text={apiKey} label="העתק" />
                </div>
              </div>
              <div className="bg-slate-800/60 border border-slate-700/30 rounded-lg p-3">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">כתובת שרת</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-sm text-cyan-400 font-mono bg-slate-900/60 px-3 py-1.5 rounded border border-slate-700/40 flex-1 min-w-0 truncate">{serverUrl}</code>
                  <CopyButton text={serverUrl} label="העתק" />
                </div>
              </div>
              <div className="bg-slate-800/60 border border-slate-700/30 rounded-lg p-3">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">כתובת סוכן מקומי</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-sm text-cyan-400 font-mono bg-slate-900/60 px-3 py-1.5 rounded border border-slate-700/40 flex-1 min-w-0 truncate">http://localhost:4000</code>
                  <CopyButton text="http://localhost:4000" label="העתק" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "fleet" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-semibold text-white">נקודות קצה מוגנות</span>
            <LiveDot color="bg-purple-500" />
          </div>
          {agents.length === 0 ? (
            <div className="text-center py-10 text-slate-600 text-sm">
              אין סוכנים מחוברים עדיין — פרוס את המגן על מחשבי העובדים
            </div>
          ) : (
            <div className="bg-slate-900/50 border border-slate-700/40 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50 text-xs text-slate-500 uppercase tracking-wider">
                    <th className="text-right px-4 py-3">שם סוכן</th>
                    <th className="text-right px-4 py-3 hidden sm:table-cell">סביבה</th>
                    <th className="text-right px-4 py-3">סטטוס</th>
                    <th className="text-right px-4 py-3 hidden md:table-cell">חסימות</th>
                    <th className="text-right px-4 py-3 hidden lg:table-cell">פינג אחרון</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a, i) => (
                    <tr key={a._id} className={clsx("border-b border-slate-800/60", i % 2 === 0 ? "bg-slate-900/20" : "")}>
                      <td className="px-4 py-3 font-medium text-white">
                        <span className="truncate max-w-[160px] block">{a.name}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 hidden sm:table-cell">{a.environment}</td>
                      <td className="px-4 py-3">
                        <span className={clsx("text-xs font-medium px-2 py-0.5 rounded-full border",
                          a.syncStatus === "active"   ? "bg-green-500/15 text-green-400 border-green-500/25" :
                          a.syncStatus === "learning" ? "bg-blue-500/15 text-blue-400 border-blue-500/25" :
                          "bg-slate-700/40 text-slate-500 border-slate-600/30")}>
                          {a.syncStatus === "active" ? "🛡 פעיל" : a.syncStatus === "learning" ? "🔵 לומד" : "○ מנותק"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">
                        {(a.metrics?.blocksExecuted || 0) > 0
                          ? <span className="text-rose-400 font-semibold">{formatNum(a.metrics.blocksExecuted)}</span>
                          : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500 text-xs hidden lg:table-cell">
                        {a.lastPing ? new Date(a.lastPing).toLocaleString("he-IL") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function KpiStrip({ stats }) {
  const items = [
    { icon: Replace,   label: "החלפות כולל",        value: formatNum(stats?.totalBlocks),     color: "text-cyan-400",   border: "border-cyan-500/20",   sub: `היום: ${formatNum(stats?.blocksToday)}`  },
    { icon: Wifi,      label: "נקודות קצה מחוברות", value: formatNum(stats?.connectedAgents), color: "text-purple-400", border: "border-purple-500/20", sub: `${formatNum(stats?.totalAgents ?? 0)} סוכנים`  },
    { icon: UserCheck, label: "משתמשים מחוברים",    value: formatNum(stats?.onlineUsers ?? 0), color: "text-green-400",  border: "border-green-500/20",  sub: `${formatNum(stats?.totalUsers ?? 0)} סה"כ` },
    { icon: Brain,     label: "סריקות כולל",        value: formatNum(stats?.totalScans),      color: "text-purple-400", border: "border-purple-500/20", sub: "סריקות DLP"                             },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map(({ icon: Icon, label, value, color, border, sub }) => (
        <MetricCard key={label} icon={Icon} label={label} value={value} sub={sub} color={color} border={border} />
      ))}
    </div>
  );
}

const EVENT_LABELS = {
  scan: "סריקה", block: "החלפה", alert: "התראה",
  agent_connect: "חיבור סוכן", agent_disconnect: "ניתוק סוכן",
  config_change: "שינוי הגדרות", user_action: "פעולת משתמש",
};
const SEVERITY_COLOR = { low: "text-slate-400", medium: "text-yellow-400", high: "text-orange-400", critical: "text-red-400" };

function relativeTime(ts) {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `לפני ${s} שנ'`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `לפני ${m} דק'`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `לפני ${h} שע'`;
  return `לפני ${Math.floor(h / 24)} ימ'`;
}

function ConnectedUsersPanel({ userStats = [] }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [sortKey, setSortKey] = useState("replacements");
  const [sortDir, setSortDir] = useState("desc");
  const [criticalModal, setCriticalModal] = useState(null); // user object

  function getSortValue(user, key) {
    if (key === "lastActivity") return user.lastActivity ? new Date(user.lastActivity).getTime() : 0;
    return user[key] ?? 0;
  }

  const filtered = userStats
    .filter((u) => !search || u.email.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      return sortDir === "desc" ? bv - av : av - bv;
    });

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  const SortIcon = ({ k }) =>
    sortKey === k
      ? (sortDir === "desc" ? <ChevronDown className="w-3 h-3 inline ml-0.5" /> : <ChevronUp className="w-3 h-3 inline ml-0.5" />)
      : null;

  const onlineCount = userStats.filter((u) => u.online).length;
  const criticalCount = userStats.filter((u) => (u.criticalCount || 0) > 0).length;

  return (
    <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-5 space-y-4">
      {/* Critical leak modal */}
      {criticalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setCriticalModal(null)}>
          <div
            className="bg-[#0d0d14] border border-red-500/40 rounded-2xl p-6 max-w-md w-full mx-4 shadow-[0_0_40px_rgba(239,68,68,0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <h3 className="text-sm font-bold text-red-300">דליפה קריטית — {criticalModal.email}</h3>
              </div>
              <button onClick={() => setCriticalModal(null)} className="text-slate-500 hover:text-slate-200 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="bg-red-500/10 border border-red-500/25 rounded-lg px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-slate-400">אירועים קריטיים / גבוהים</span>
                <span className="text-red-400 font-bold text-lg">{formatNum(criticalModal.criticalCount)}</span>
              </div>

              {criticalModal.lastCriticalEvent && (
                <div className="bg-slate-800/60 rounded-lg px-4 py-3 space-y-1.5 text-xs">
                  <p className="text-slate-500 uppercase tracking-wide text-[10px]">אירוע אחרון</p>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">חומרה:</span>
                    <span className={clsx(
                      "font-semibold px-2 py-0.5 rounded-full border text-[10px]",
                      criticalModal.lastCriticalEvent.severity === "critical"
                        ? "bg-red-500/20 text-red-400 border-red-500/30"
                        : "bg-orange-500/20 text-orange-400 border-orange-500/30"
                    )}>
                      {criticalModal.lastCriticalEvent.severity === "critical" ? "🔴 קריטי" : "🟠 גבוה"}
                    </span>
                  </div>
                  {criticalModal.lastCriticalEvent.category && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">קטגוריה:</span>
                      <span className="text-white font-medium">{criticalModal.lastCriticalEvent.category}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">זמן:</span>
                    <span className="text-slate-300">{relativeTime(criticalModal.lastCriticalEvent.timestamp)}</span>
                  </div>
                </div>
              )}

              {Object.keys(criticalModal.categories || {}).length > 0 && (
                <div className="bg-slate-800/60 rounded-lg px-4 py-3 space-y-2 text-xs">
                  <p className="text-slate-500 uppercase tracking-wide text-[10px]">פירוט קטגוריות שנחסמו</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(criticalModal.categories).sort(([, a], [, b]) => b - a).map(([cat, count]) => (
                      <span key={cat} className="bg-slate-700/60 text-slate-300 px-2.5 py-1 rounded-full border border-slate-600/40">
                        {cat}: <strong className="text-white">{count}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => setCriticalModal(null)}
              className="mt-4 w-full py-2 rounded-lg bg-slate-700/60 text-slate-300 text-xs hover:bg-slate-600/60 transition-colors"
            >
              סגור
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/20">
            <Users className="w-4 h-4 text-green-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">ניהול משתמשים מחוברים</h3>
            <p className="text-xs text-slate-500">
              <span className="text-green-400 font-semibold">{onlineCount} מחוברים כעת</span>
              {" · "}
              {userStats.length} משתמשים סה"כ
              {criticalCount > 0 && (
                <> · <span className="text-red-400 font-semibold">{criticalCount} עם דליפה קריטית</span></>
              )}
            </p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי אימייל..."
            dir="ltr"
            className="bg-slate-800/60 border border-slate-700/50 rounded-lg pr-8 pl-3 py-2 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-cyan-600/60 w-56"
          />
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-8 text-slate-600 text-sm">
          {search ? "לא נמצאו משתמשים" : "אין נתוני משתמשים עדיין"}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700/40">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800/60 border-b border-slate-700/40 text-slate-400 uppercase tracking-wide text-[10px]">
                <th className="text-right px-4 py-3">סטטוס</th>
                <th className="text-right px-4 py-3">אימייל</th>
                <th
                  className="text-center px-4 py-3 cursor-pointer hover:text-slate-200 transition-colors"
                  onClick={() => toggleSort("replacements")}
                >
                  החלפות <SortIcon k="replacements" />
                </th>
                <th
                  className="text-right px-4 py-3 hidden sm:table-cell cursor-pointer hover:text-slate-200 transition-colors"
                  onClick={() => toggleSort("lastActivity")}
                >
                  פעילות אחרונה <SortIcon k="lastActivity" />
                </th>
                <th className="text-center px-4 py-3">פירוט</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <>
                  <tr
                    key={user.email}
                    className={clsx(
                      "border-b border-slate-800/50 transition-colors cursor-pointer",
                      expanded === user.email ? "bg-slate-800/40" : "hover:bg-slate-800/20"
                    )}
                    onClick={() => setExpanded(expanded === user.email ? null : user.email)}
                  >
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        <span className={clsx("w-2 h-2 rounded-full shrink-0", user.online ? "bg-green-400 animate-pulse" : "bg-slate-600")} />
                        <span className={clsx("text-[10px] font-medium", user.online ? "text-green-400" : "text-slate-500")}>
                          {user.online ? "פעיל" : "לא מחובר"}
                        </span>
                        {/* Red badge for critical leak */}
                        {(user.criticalCount || 0) > 0 && (
                          <button
                            title="דליפה קריטית – לחץ לפרטים"
                            onClick={(e) => { e.stopPropagation(); setCriticalModal(user); }}
                            className="flex items-center gap-0.5 bg-red-500/20 border border-red-500/40 text-red-400 rounded-full px-1.5 py-0.5 text-[9px] font-bold hover:bg-red-500/35 transition-colors animate-pulse"
                          >
                            <AlertTriangle className="w-2.5 h-2.5" />
                            {user.criticalCount}
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-200 font-mono" dir="ltr">{user.email}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={clsx(
                        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold text-xs border",
                        user.replacements > 50 ? "bg-red-500/15 text-red-400 border-red-500/25" :
                        user.replacements > 10 ? "bg-orange-500/15 text-orange-400 border-orange-500/25" :
                        user.replacements > 0  ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/25" :
                        "bg-slate-800/50 text-slate-500 border-slate-700/30"
                      )}>
                        <Replace className="w-3 h-3" />
                        {formatNum(user.replacements)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">{relativeTime(user.lastActivity)}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        className="text-slate-400 hover:text-cyan-400 transition-colors"
                        onClick={(e) => { e.stopPropagation(); setExpanded(expanded === user.email ? null : user.email); }}
                      >
                        {expanded === user.email ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                  {expanded === user.email && (
                    <tr key={`${user.email}-detail`} className="bg-slate-800/30 border-b border-slate-800/50">
                      <td colSpan={5} className="px-6 py-4">
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-4 text-xs">
                            <div className="bg-slate-900/60 rounded-lg px-3 py-2 border border-slate-700/40">
                              <p className="text-slate-500 mb-1">פעילות אחרונה</p>
                              <p className="text-slate-200 font-medium">
                                {user.lastActivity ? new Date(user.lastActivity).toLocaleString("he-IL") : "—"}
                              </p>
                            </div>
                            <div className="bg-slate-900/60 rounded-lg px-3 py-2 border border-slate-700/40">
                              <p className="text-slate-500 mb-1">סה"כ החלפות</p>
                              <p className="text-cyan-400 font-bold text-lg">{formatNum(user.replacements)}</p>
                            </div>
                            {(user.criticalCount || 0) > 0 && (
                              <div
                                className="bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/25 cursor-pointer hover:bg-red-500/20 transition-colors"
                                onClick={() => setCriticalModal(user)}
                              >
                                <p className="text-red-400/70 mb-1">אירועים קריטיים</p>
                                <p className="text-red-400 font-bold text-lg flex items-center gap-1">
                                  <AlertTriangle className="w-4 h-4" />
                                  {formatNum(user.criticalCount)}
                                </p>
                              </div>
                            )}
                          </div>
                          {Object.keys(user.categories || {}).length > 0 && (
                            <div>
                              <p className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wide">פירוט קטגוריות</p>
                              <div className="flex flex-wrap gap-2">
                                {Object.entries(user.categories).map(([cat, count]) => (
                                  <span key={cat} className="bg-slate-700/60 text-slate-300 text-xs px-2.5 py-1 rounded-full border border-slate-600/40">
                                    {cat}: <strong className="text-white">{count}</strong>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RecentEvents({ events }) {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? events : events.slice(0, 10);

  return (
    <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-red-400" />
          <span className="text-sm font-semibold text-white">יומן אירועים אחרונים</span>
          <span className="text-xs text-slate-500">({events.length})</span>
        </div>
        {events.length > 10 && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            {showAll ? "הצג פחות ▲" : `הצג הכל (${events.length}) ▼`}
          </button>
        )}
      </div>
      {events.length === 0 ? (
        <p className="text-xs text-slate-600 text-center py-4">אין אירועים עדיין</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800/60">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800/50 border-b border-slate-800/60 text-slate-500 uppercase tracking-wide text-[10px]">
                <th className="text-right px-3 py-2">אירוע</th>
                <th className="text-right px-3 py-2 hidden sm:table-cell">אימייל</th>
                <th className="text-center px-3 py-2">חומרה</th>
                <th className="text-right px-3 py-2">זמן</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((e, i) => (
                <tr key={e._id || i} className="border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors">
                  <td className="px-3 py-2 text-slate-300 font-medium">{EVENT_LABELS[e.eventType] || e.eventType}</td>
                  <td className="px-3 py-2 text-slate-500 hidden sm:table-cell font-mono truncate max-w-[160px]" dir="ltr">
                    {e.userEmail || "—"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={clsx("font-semibold", SEVERITY_COLOR[e.severity] || "text-slate-500")}>
                      {e.severity || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600 shrink-0">
                    {e.timestamp ? relativeTime(e.timestamp) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AuthGate({ onAuth }) {
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const requestKey = resolveTenantApiKey(key);
    if (!requestKey) return;
    setErr(""); setLoading(true);
    try {
      const res = await fetch(TENANT_DASHBOARD_API_PATH, { headers: { "x-api-key": requestKey } });
      if (res.ok) {
        onAuth(requestKey, await res.json());
      } else {
        let msg = "מפתח שגוי";
        try { const d = await res.json(); msg = d.error || msg; } catch {}
        if (msg.includes("מפתח API אינו תקין") || msg.toLowerCase().includes("invalid api")) {
          msg = "מפתח API אינו תקין. יש להזין מפתח דייר (Tenant API Key) מתוך Super Admin > Tenant Details.";
        }
        setErr(msg);
      }
    } catch { setErr("שגיאת רשת — אנא נסה שוב"); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#030712] flex items-center justify-center" dir="rtl">
      <div className="w-80 bg-[#0d0d14] border border-cyan-900/40 rounded-2xl p-8 space-y-5 shadow-[0_0_60px_rgba(34,211,238,0.07)]">
        <div className="flex items-center gap-3">
          <GhostLogo size={24} className="text-cyan-400" />
          <div>
            <h1 className="text-cyan-300 font-bold text-sm tracking-widest">GHOST</h1>
            <p className="text-slate-500 text-xs">מרכז ניהול לקוח</p>
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">מפתח API של הדייר</label>
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2.5 text-sm text-slate-200 font-mono outline-none focus:border-cyan-600/60"
            placeholder="הכנס מפתח API..." dir="ltr" />
          <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
            אם מתקבלת שגיאת "API לא תקין", קח את המפתח מתוך מסך ניהול-העל של הדייר.
          </p>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button onClick={submit} disabled={!key || loading}
          className="w-full py-2.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-600/40 rounded-lg text-sm text-cyan-300 font-medium transition-colors disabled:opacity-40">
          {loading ? "מאמת..." : "כניסה למרכז הניהול"}
        </button>
      </div>
    </div>
  );
}

export default function CommandCenterDashboard() {
  const [apiKey, setApiKey] = useState(null);
  const [data, setData]     = useState(null);
  const [isHydrating, setIsHydrating] = useState(true);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [time, setTime]     = useState("");
  const refreshRef = useRef(null);

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("he-IL", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Restore API key from local/session storage (or env fallback) on mount.
  useEffect(() => {
    try {
      const saved = resolveTenantApiKey();
      if (saved) setApiKey(saved);
    } catch {}
    setIsHydrating(false);
  }, []);

  const redirectToAuth = useCallback(() => {
    clearPersistedTenantApiKey();
    setApiKey(null);
    setData(null);
    window.location.replace("/admin");
  }, []);

  const loadData = useCallback(async (key) => {
    const requestKey = resolveTenantApiKey(key);
    if (!requestKey) {
      redirectToAuth();
      return;
    }
    setIsDataLoading(true);
    try {
      const res = await fetch(TENANT_DASHBOARD_API_PATH, { headers: { "x-api-key": requestKey } });
      if (res.ok) {
        setData(await res.json());
      } else if (res.status === 401 || res.status === 403) {
        redirectToAuth();
      }
    } catch {}
    finally { setIsDataLoading(false); }
  }, [redirectToAuth]);

  const handleAuth = useCallback((key, initialData) => {
    persistTenantApiKey(key);
    setApiKey(key);
    setData(initialData);
  }, []);

  // Initial data load when apiKey is restored from sessionStorage.
  useEffect(() => {
    if (apiKey && !data) loadData(apiKey);
  }, [apiKey, data, loadData]);

  useEffect(() => {
    if (!apiKey) return;
    refreshRef.current = setInterval(() => loadData(apiKey), 15000);
    return () => clearInterval(refreshRef.current);
  }, [apiKey, loadData]);

  if (isHydrating || (apiKey && isDataLoading && !data)) {
    return (
      <div className="min-h-screen bg-[#030712] flex items-center justify-center text-slate-300" dir="rtl">
        Loading
      </div>
    );
  }

  if (!apiKey) return <AuthGate onAuth={handleAuth} />;

  return (
    <div className="min-h-screen bg-[#030712] text-white" dir="rtl">
      <header className="sticky top-0 z-40 flex items-center justify-between px-6 py-3 bg-[#030712]/90 backdrop-blur border-b border-slate-800/60">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-cyan-500/10 rounded-lg border border-cyan-500/20">
            <GhostLogo size={20} className="text-cyan-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-bold text-base tracking-tight text-white">GHOST</span>
            {data?.tenant?.name && <span className="text-xs text-cyan-400 font-medium">{data.tenant.name}</span>}
            <span className="text-xs text-slate-500 font-medium tracking-widest uppercase hidden md:inline">מרכז ניהול</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <LiveDot color="bg-green-500" />
            <span className="text-xs text-green-400 font-medium hidden sm:inline">מערכת פעילה</span>
          </div>
          <code className="text-xs text-slate-500 font-mono hidden md:block">{time}</code>
          <button onClick={() => loadData(apiKey)}
            className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-200" title="רענן נתונים">
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => {
              clearPersistedTenantApiKey();
              setApiKey(null);
              setData(null);
            }}
            className="p-1.5 rounded-lg hover:bg-red-900/30 transition-colors text-slate-500 hover:text-red-400"
            title="יציאה"
          >
            <LogOut size={14} />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
        <div className="text-center space-y-2 pt-2">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            <span className="text-white">פרוס</span>{" "}
            <span className="bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">GHOST</span>{" "}
            <span className="text-white">תוך דקות</span>
          </h1>
          <p className="text-slate-400 text-base max-w-xl mx-auto">
            שני שלבים. מניעת דליפת מידע עם AI — ללא גישת ספק, ללא יציאת מידע מהרשת שלך.
          </p>
        </div>

        <KpiStrip stats={data?.stats} />

        {(data?.agents?.length ?? 0) > 0 && (
          <AgentIntelligencePanel agents={data.agents} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[
            { num: "01", label: "חיבור מוח השרת",    color: "border-cyan-500/30   bg-cyan-500/5"   },
            { num: "02", label: "פריסת מגני עובדים", color: "border-purple-500/30 bg-purple-500/5" },
          ].map(({ num, label, color }) => (
            <div key={num} className={clsx("flex items-center gap-3 rounded-xl border px-5 py-3", color)}>
              <span className="text-2xl font-black text-white/20">{num}</span>
              <ChevronRight className="w-4 h-4 text-slate-600" />
              <span className="font-semibold text-white text-sm">{label}</span>
            </div>
          ))}
        </div>

        <div className="bg-slate-900/40 border border-slate-700/40 rounded-2xl p-6 lg:p-8 shadow-xl shadow-black/20">
          <ServerBrainPhase data={data} />
        </div>

        <div className="bg-slate-900/40 border border-slate-700/40 rounded-2xl p-6 lg:p-8 shadow-xl shadow-black/20">
          <WorkerShieldPhase data={data} />
        </div>

        <ConnectedUsersPanel userStats={data?.userStats || []} />

        <ActiveUsersPanel apiKey={apiKey} />

        <CustomKeywordsManager apiKey={apiKey} />

        <RecentEvents events={data?.recentEvents || []} />

        <p className="text-center text-xs text-slate-700 pb-6">
          GHOST מעבד את כל המידע הרגיש באופן מקומי. שום טקסט רגיל לא מגיע ל-LLM חיצוניים או שרתים של צד שלישי.
        </p>
      </main>
    </div>
  );
}
