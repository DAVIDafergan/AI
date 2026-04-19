"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Building2, ArrowLeft, Cpu, Activity, Terminal, Copy, CheckCheck,
  Server, Users, Plus, Loader2, Link, Shield, Trash2, Save, Wifi,
  Brain, CheckCircle2, Circle, AlertCircle, RefreshCw,
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
  agent_provision_error: "שגיאת התקנת סוכן",
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

function ConnectionInstructions({ tenant, superAdminKey, onAgentProvisioned }) {
  const serverUrl =
    tenant.serverUrl ||
    process.env.NEXT_PUBLIC_DLP_SERVER_URL ||
    (typeof window !== "undefined" ? window.location.origin : "");
  const apiKey = tenant.apiKey || "";
  const [provName, setProvName] = useState("");
  const [provisioning, setProvisioning] = useState(false);
  const [provError, setProvError] = useState("");
  const [tab, setTab] = useState("central-agent");

  // Full npx command for the Central AI Agent (runs ONCE on the file server)
  const centralAgentCmd =
    `npx ghostlayer-agent --server-url=${serverUrl || "<SERVER_URL>"} --api-key=${apiKey} --dir="C:\\Company_Shared_Drive" --local-port=4000`;

  const handleProvision = async () => {
    if (!provName.trim()) return;
    setProvisioning(true); setProvError("");
    try {
      const res = await fetch("/api/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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
    { id: "central-agent", label: "סוכן AI מרכזי (לשרת הארגון)" },
    { id: "extension",     label: "מגן עובדים (תוסף דפדפן)"    },
  ];

  return (
    <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl overflow-hidden" dir="rtl">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2 border-b border-slate-800">
        <Link size={14} className="text-cyan-400" />
        <span className="text-sm text-slate-300 font-medium">הוראות התקנה והפעלה</span>
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

        {/* ── טאב 1: סוכן AI מרכזי ── */}
        {tab === "central-agent" && (
          <div className="space-y-4">

            {/* כותרת ותיאור */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Server size={14} className="text-cyan-400" />
                <span className="text-xs font-semibold text-slate-200">סוכן AI מרכזי לשרת הארגון</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                הסוכן המרכזי מותקן <strong className="text-slate-300">פעם אחת בלבד</strong> על שרת הקבצים הארגוני המרכזי.
                הוא סורק את הכונן המשותף, לומד את תוכן הנתונים הארגוניים, ובונה מוח AI מקומי המשמש
                את תוספי הדפדפן של העובדים לזיהוי מידע רגיש בזמן אמת.
                <span className="block mt-1 text-slate-500">⚠️ כל העיבוד מתבצע מקומית — שום תוכן רגיש אינו עוזב את השרת.</span>
              </p>
            </div>

            {/* שלבי התקנה */}
            <ol className="space-y-2">
              {[
                "ודא כי Node.js גרסה 18 ומעלה מותקנת על שרת הקבצים.",
                'הרץ את הפקודה הבאה בחלון הפקודות (CMD / PowerShell) על שרת הקבצים — הפקודה תסרוק את הכונן, תיצור מוח AI מקומי, ותפעיל שרת API פנימי.',
                'לאחר סיום הסריקה, הסוכן ימשיך לרוץ ויקשיב על הפורט המוגדר. ניתן לרשום אותו כשירות מערכת (Windows Service / systemd) להפעלה אוטומטית.',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 text-[9px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-xs text-slate-300 leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>

            {/* פקודת הרצה */}
            <div className="bg-slate-950 border border-slate-700/40 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-900/70 border-b border-slate-700/40">
                <div className="flex items-center gap-1.5">
                  <Terminal size={11} className="text-slate-500" />
                  <span className="text-[10px] text-slate-400">פקודת הפעלה — שרת הקבצים</span>
                </div>
                <CopyButton text={centralAgentCmd} label="העתק פקודה" />
              </div>
              <div className="px-3 py-3 overflow-x-auto" dir="ltr">
                <code className="text-[11px] text-green-400 font-mono whitespace-pre">{centralAgentCmd}</code>
              </div>
            </div>

            {/* פרמטרים */}
            <div className="bg-slate-900/40 border border-slate-700/30 rounded-lg p-3 space-y-1.5 text-[10px]">
              <div className="text-slate-400 font-medium mb-2">פירוט הפרמטרים:</div>
              {[
                ["--server-url", "כתובת לוח הבקרה של GHOST (מוגדר אוטומטית)"],
                ["--api-key", "מפתח ה-API הייחודי לדייר זה"],
                ['--dir', 'נתיב לכונן המשותף הארגוני (לדוגמה: C:\\Company_Shared_Drive)'],
                ["--local-port", "פורט שרת ה-API המקומי שיאזין לבקשות מתוספי הדפדפן (ברירת מחדל: 4000)"],
              ].map(([param, desc]) => (
                <div key={param} className="flex gap-2">
                  <code className="text-cyan-400/80 font-mono shrink-0">{param}</code>
                  <span className="text-slate-500">{desc}</span>
                </div>
              ))}
            </div>

            {/* מפתח API */}
            <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-700/40 rounded-lg px-3 py-2">
              <span className="text-[10px] text-slate-500">מפתח API של הדייר:</span>
              <code className="text-[10px] text-cyan-400 font-mono flex-1 truncate" dir="ltr">{apiKey}</code>
              <CopyButton text={apiKey} />
            </div>

            {/* Provision new agent */}
            <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg p-3 space-y-2">
              <div className="text-xs text-slate-400 font-medium">רישום סוכן חדש בלוח הבקרה</div>
              <div className="flex gap-2">
                <input
                  value={provName}
                  onChange={(e) => setProvName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleProvision()}
                  placeholder="שם הסוכן (למשל: main-file-server)"
                  className="flex-1 bg-slate-900/60 border border-slate-700/60 rounded px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-600/60 font-mono"
                  dir="ltr"
                />
                <button onClick={handleProvision} disabled={!provName.trim() || provisioning}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/20 border border-cyan-600/40 rounded text-xs text-cyan-300 hover:bg-cyan-500/30 disabled:opacity-40 transition-colors">
                  {provisioning ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  רשום סוכן
                </button>
              </div>
              {provError && !provError.includes("Path collision") && <p className="text-xs text-red-400">{provError}</p>}
            </div>
          </div>
        )}

        {/* ── טאב 2: מגן עובדים (תוסף דפדפן) ── */}
        {tab === "extension" && (
          <div className="space-y-4">

            {/* כותרת ותיאור */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Shield size={14} className="text-green-400" />
                <span className="text-xs font-semibold text-slate-200">מגן עובדים — תוסף דפדפן</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                תוסף הדפדפן מגן על פעילות הגלישה של כל עובד בזמן אמת. בכל פעם שעובד מנסה לשתף או
                להדביק טקסט באתר חיצוני, התוסף שולח את הקטע <strong className="text-slate-300">לסוכן ה-AI המרכזי</strong>
                {" "}(הרץ על שרת הקבצים) לבדיקה מקומית. אם הקטע מכיל מידע ארגוני רגיש — הפעולה נחסמת מיידית.
                <span className="block mt-1 text-slate-500">⚠️ הבדיקה מתבצעת לחלוטין בתוך הרשת הפנימית — שום מידע לא מגיע לענן.</span>
              </p>
            </div>

            {/* שלבי הגדרה */}
            <ol className="space-y-2">
              {[
                `הורד את תוסף Chrome הארגוני מהכתובת: ${serverUrl}/extension/ghostlayer.crx`,
                "פתח Chrome ועבור אל: chrome://extensions → הפעל מצב מפתח → גרור את קובץ ה-.crx להתקנה.",
                "לאחר ההתקנה, פתח את הגדרות התוסף (לחץ על האייקון ← הגדרות).",
                'בשדה "כתובת הסוכן המקומי", הכנס את כתובת ה-IP של שרת הקבצים הארגוני עם הפורט — לדוגמה: http://10.0.0.50:4000',
                `בשדה "מפתח API", הכנס את: ${apiKey}`,
                'לחץ "שמור ואמת חיבור" — התוסף יתחבר לסוכן המרכזי וההגנה תופעל מיידית.',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-green-500/20 border border-green-500/40 text-green-400 text-[9px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-xs text-slate-300 leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>

            {/* פרטי חיבור */}
            <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg px-3 py-3 space-y-2">
              <div className="text-[10px] text-slate-400 font-medium mb-1">פרטי חיבור לתוסף:</div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500">כתובת הסוכן המקומי:</span>
                <code className="text-[10px] text-yellow-400 font-mono" dir="ltr">http://&lt;IP-שרת-הקבצים&gt;:4000</code>
              </div>
              <div className="text-[10px] text-slate-600 pr-2">
                לדוגמה: <code className="text-yellow-400/70 font-mono" dir="ltr">http://10.0.0.50:4000</code>
                {" "}(החלף בכתובת ה-IP בפועל של שרת הקבצים שלך)
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-slate-800">
                <span className="text-[10px] text-slate-500">מפתח API של הדייר:</span>
                <code className="text-[10px] text-cyan-400 font-mono flex-1 truncate" dir="ltr">{apiKey}</code>
                <CopyButton text={apiKey} />
              </div>
            </div>

            {/* הערת פריסה */}
            <div className="flex items-start gap-2 bg-blue-500/5 border border-blue-500/20 rounded-lg px-3 py-2">
              <Users size={12} className="text-blue-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-slate-400 leading-relaxed">
                <strong className="text-slate-300">פריסה ארגונית:</strong> ניתן להפיץ את התוסף לכלל תחנות העבודה דרך
                {" "}<strong className="text-slate-300">Microsoft Intune</strong> (Windows) או{" "}
                <strong className="text-slate-300">Jamf Pro</strong> (macOS) תוך הגדרה מרכזית של כתובת הסוכן ומפתח ה-API
                — ללא צורך בהגדרה ידנית בכל מחשב.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TenantDetailView({ tenant, superAdminKey, onBack }) {
  const [agents, setAgents]           = useState([]);
  const [events, setEvents]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [remoteInstall, setRemoteInstall] = useState(tenant?.remoteInstall || null);
  const [agentActionLoading, setAgentActionLoading] = useState("");
  const [agentActionError, setAgentActionError] = useState("");
  const [agentLogs, setAgentLogs] = useState("");
  const [activeUsers, setActiveUsers] = useState([]);
  const [serverUrlEdit, setServerUrlEdit] = useState(tenant?.serverUrl || "");
  const [agentUrlEdit, setAgentUrlEdit] = useState(tenant?.agentUrl || "");
  const [savingUrl, setSavingUrl]         = useState(false);
  const [urlSaveMsg, setUrlSaveMsg]       = useState("");

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const [agentsRes, eventsRes, usersRes] = await Promise.all([
        fetch(`/api/agents?tenantId=${tenant._id}`, {
          credentials: "include",
        }),
        fetch(`/api/tenant-events?tenantId=${tenant._id}&limit=25`, {
          credentials: "include",
        }),
        fetch(`/api/tenant-users?tenantId=${tenant._id}`, {
          credentials: "include",
        }),
      ]);
      if (agentsRes.ok) {
        const agentsData = await agentsRes.json();
        setAgents(agentsData.agents || []);
        setRemoteInstall(agentsData.remoteInstall || null);
      }
      if (eventsRes.ok) setEvents((await eventsRes.json()).events || []);
      if (usersRes.ok)  setActiveUsers((await usersRes.json()).users  || []);
    } finally {
      setLoading(false);
    }
  }, [tenant, superAdminKey]);

  const saveServerUrl = async () => {
    setSavingUrl(true);
    setUrlSaveMsg("");
    try {
      const res = await fetch(`/api/tenants/${tenant._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error || "שגיאה");
      setUrlSaveMsg("✓ נשמר");
      tenant.serverUrl = serverUrlEdit;
      tenant.agentUrl = agentUrlEdit;
    } catch (e) {
      setUrlSaveMsg(`✗ ${e.message}`);
    } finally {
      setSavingUrl(false);
      setTimeout(() => setUrlSaveMsg(""), 3000);
    }
  };

  const deleteAgent = async (agentId, agentName) => {
    if (!confirm(`האם למחוק את הסוכן "${agentName}"?`)) return;
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error || "שגיאה במחיקה");
      setAgents((prev) => prev.filter((a) => a._id !== agentId));
    } catch (e) {
      alert(`שגיאה במחיקת הסוכן: ${e.message}`);
    }
  };

  const refreshAgentStatus = useCallback(async () => {
    if (!tenant?._id) return;
    try {
      const res = await fetch(`/api/agents?tenantId=${tenant._id}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      setAgents(data.agents || []);
      setRemoteInstall(data.remoteInstall || null);
    } catch {}
  }, [tenant, superAdminKey]);

  const runAgentAction = async (action) => {
    setAgentActionError("");
    setAgentActionLoading(action);
    try {
      const res = await fetch("/api/provision-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, tenantId: tenant._id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "שגיאה");
      if (action === "logs") setAgentLogs(data.logs || "");
      await refreshAgentStatus();
    } catch (e) {
      setAgentActionError(e.message);
    } finally {
      setAgentActionLoading("");
    }
  };

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!tenant?._id) return;
    const statusPollInterval = setInterval(() => { refreshAgentStatus(); }, 10000);
    return () => clearInterval(statusPollInterval);
  }, [tenant, refreshAgentStatus]);

  if (!tenant) return null;

  const connectedAgents = agents.filter((a) => a.syncStatus !== "offline").length;
  const learningAgents  = agents.filter((a) => a.syncStatus === "learning").length;
  const activeAgents    = agents.filter((a) => a.syncStatus === "active").length;
  const totalBlocks = agents.reduce((sum, a) => sum + (a.metrics?.blocksExecuted || 0), 0);
  const totalScans  = agents.reduce((sum, a) => sum + (a.metrics?.scansPerformed  || 0), 0);
  const totalDocs   = agents.reduce((sum, a) => sum + (a.metrics?.documentsIndexed || 0), 0);

  const statusLabel = {
    active:    "פעיל",
    trial:     "ניסיון",
    suspended: "מושהה",
    expired:   "פג תוקף",
  };

  // Connection wizard steps
  const wizardStep = agents.length === 0 ? 1
    : connectedAgents === 0 ? 1
    : learningAgents > 0    ? 2
    : activeAgents > 0      ? 3
    : 2;

  const wizardSteps = [
    {
      num: 1,
      label: "סוכן מחובר לשרת",
      done: connectedAgents > 0,
      active: wizardStep === 1,
      desc: connectedAgents > 0
        ? `${connectedAgents} סוכן${connectedAgents > 1 ? "ים" : ""} מחובר${connectedAgents > 1 ? "ים" : ""}`
        : "הרץ את פקודת ההתקנה על שרת החברה",
    },
    {
      num: 2,
      label: "מנוע AI לומד",
      done: activeAgents > 0,
      active: wizardStep === 2,
      desc: activeAgents > 0
        ? `${totalDocs.toLocaleString("he-IL")} מסמכים אינדקסו`
        : learningAgents > 0
          ? "הסוכן סורק את הכונן הארגוני..."
          : "ממתין לסריקה ראשונה",
    },
    {
      num: 3,
      label: "תוסף דפדפן פעיל",
      done: activeUsers.length > 0,
      active: wizardStep === 3,
      desc: activeUsers.length > 0
        ? `${activeUsers.length} עובד${activeUsers.length > 1 ? "ים" : ""} מוגנ${activeUsers.length > 1 ? "ים" : ""}`
        : "פרוס את תוסף הדפדפן לעובדים",
    },
  ];
  const isAgentOnline = agents.some((a) => a.syncStatus !== "offline") || remoteInstall?.status === "online";

  return (
    <div className="space-y-4">
      {/* כותרת + חזרה */}
      <div className="flex items-center justify-between">
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
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded-lg transition-colors"
          title="רענן"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          רענן
        </button>
      </div>

      {/* Connection Wizard */}
      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={14} className="text-cyan-400" />
          <span className="text-sm font-semibold text-slate-200">סטטוס חיבור</span>
          <span className="text-xs text-slate-600 mr-auto">3 שלבים לפעולה מלאה</span>
        </div>
        <div className="flex items-start gap-0">
          {wizardSteps.map((step, idx) => (
            <div key={step.num} className="flex-1 flex flex-col items-center relative">
              {/* Connector line */}
              {idx < wizardSteps.length - 1 && (
                <div className={`absolute top-3.5 right-1/2 w-full h-0.5 -translate-y-1/2 ${step.done ? "bg-cyan-500/60" : "bg-slate-700/60"}`} style={{ zIndex: 0 }} />
              )}
              {/* Circle */}
              <div className={`relative z-10 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all ${
                step.done
                  ? "bg-cyan-500/20 border-cyan-500/60"
                  : step.active
                    ? "bg-blue-500/20 border-blue-500/60 animate-pulse"
                    : "bg-slate-800/60 border-slate-700/40"
              }`}>
                {step.done
                  ? <CheckCircle2 size={14} className="text-cyan-400" />
                  : step.active
                    ? <Circle size={14} className="text-blue-400" />
                    : <Circle size={14} className="text-slate-600" />
                }
              </div>
              {/* Labels */}
              <div className="mt-2 text-center px-1">
                <p className={`text-[10px] font-semibold ${step.done ? "text-cyan-300" : step.active ? "text-blue-300" : "text-slate-500"}`}>
                  {step.label}
                </p>
                <p className={`text-[9px] mt-0.5 ${step.done ? "text-slate-400" : step.active ? "text-slate-500" : "text-slate-600"}`}>
                  {step.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
        {wizardStep === 1 && agents.length === 0 && (
          <div className="mt-4 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2.5">
            <p className="text-xs text-amber-300 font-medium flex items-center gap-2">
              <AlertCircle size={13} />
              סוכן לא מחובר — פתח את &quot;הוראות התקנה&quot; למטה והרץ את הפקודה על שרת החברה
            </p>
          </div>
        )}
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

      {/* משתמשי תוסף פעילים */}
      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Wifi size={14} className="text-emerald-400" />
            <span className="text-sm text-slate-300 font-medium">משתמשי תוסף פעילים</span>
            <span className="text-xs text-slate-600">(15 דק׳ האחרונות)</span>
          </div>
          <span className="text-xs text-emerald-400 font-mono">{activeUsers.length} מחוברים</span>
        </div>
        {loading ? (
          <p className="text-xs text-slate-600">טוען...</p>
        ) : activeUsers.length === 0 ? (
          <p className="text-xs text-slate-600">אין משתמשים פעילים כרגע — התוסף נשלח פינג כל 5 דקות</p>
        ) : (
          <div className="space-y-1">
            {activeUsers.map((u) => (
              <div key={u.userEmail} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-800/40">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                  </span>
                  <span className="text-slate-300 font-mono truncate max-w-[180px]">{u.userEmail}</span>
                </div>
                <div className="flex items-center gap-3 text-slate-500 shrink-0">
                  <span title="חסימות">🛡 {u.interceptedCount ?? 0}</span>
                  {u.extensionVersion && <span className="hidden sm:inline">v{u.extensionVersion}</span>}
                  <span title="פינג אחרון" className="hidden md:inline">
                    {u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleTimeString("he-IL") : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* הוראות חיבור */}
      <ConnectionInstructions
        tenant={tenant}
        superAdminKey={superAdminKey}
        onAgentProvisioned={fetchData}
      />

      {/* סטטוס סוכן */}
      <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server size={14} className="text-cyan-400" />
            <span className="text-sm text-slate-300 font-medium">סוכן</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={`inline-block w-2 h-2 rounded-full ${isAgentOnline ? "bg-green-400" : "bg-red-400"}`} />
            <span className="text-slate-400">{isAgentOnline ? "online" : "offline"}</span>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-400">
          <div>Last ping: <span className="text-slate-200">{agents[0]?.lastPing ? new Date(agents[0].lastPing).toLocaleString("he-IL") : "—"}</span></div>
          <div>Install dir: <span className="text-slate-200 font-mono">{remoteInstall?.installDir || "—"}</span></div>
          <div>API endpoint: <span className="text-slate-200 font-mono">{remoteInstall?.agentUrl || tenant.agentUrl || "—"}</span></div>
          <div>Last attempt: <span className="text-slate-200">{remoteInstall?.lastAttemptAt ? new Date(remoteInstall.lastAttemptAt).toLocaleString("he-IL") : "—"}</span></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => runAgentAction("restart")}
            disabled={agentActionLoading === "restart"}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-600/40 rounded text-xs text-cyan-300 disabled:opacity-40 transition-colors"
          >
            {agentActionLoading === "restart" ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Restart Agent
          </button>
          <button
            onClick={() => runAgentAction("logs")}
            disabled={agentActionLoading === "logs"}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/40 hover:bg-slate-700/60 border border-slate-600/40 rounded text-xs text-slate-200 disabled:opacity-40 transition-colors"
          >
            {agentActionLoading === "logs" ? <Loader2 size={11} className="animate-spin" /> : <Terminal size={11} />}
            View Logs
          </button>
        </div>
        {remoteInstall?.lastError?.error && !remoteInstall.lastError.error.includes("Path collision") && (
          <div className="rounded border border-red-700/40 bg-red-900/20 px-3 py-2 text-xs text-red-300">
            <div>Provision error ({remoteInstall.lastError.step || "unknown"}):</div>
            <div className="mt-0.5">{remoteInstall.lastError.error}</div>
          </div>
        )}
        {agentActionError && !agentActionError.includes("Path collision") && (
          <div className="text-xs text-red-400">{agentActionError}</div>
        )}
        {agentLogs && (
          <div className="max-h-48 overflow-y-auto rounded border border-slate-700/50 bg-[#09090f] p-2 text-[11px] text-slate-300 font-mono whitespace-pre-wrap">
            {agentLogs}
          </div>
        )}
      </div>

      {/* רשימת סוכנים עם AI brain summary */}
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
          <div className="flex flex-col items-center py-6 gap-2">
            <Cpu size={24} className="text-slate-700" />
            <p className="text-xs text-slate-600 text-center">אין סוכנים פרוסים עדיין<br />השתמש בהוראות החיבור למעלה להפעלת הסוכן הראשון</p>
          </div>
        ) : (
          <div className="space-y-3">
            {agents.map((a) => {
              const st = SYNC_STATUS_LABELS[a.syncStatus] || { label: a.syncStatus, cls: "text-slate-400" };
              const b = a.brainSummary || {};
              const hasBrain = (b.personsFound || 0) + (b.orgsFound || 0) + (b.piiFound || 0) > 0;
              return (
                <div key={a._id} className="bg-slate-900/40 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-200 font-medium">{a.name}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${st.cls}`}>{st.label}</span>
                      <button
                        onClick={() => deleteAgent(a._id, a.name)}
                        title="מחק סוכן"
                        className="p-1 rounded hover:bg-red-900/40 text-slate-500 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs text-slate-600">
                    <span>מסמכים: <span className="text-slate-400">{formatNum(a.metrics?.documentsIndexed)}</span></span>
                    <span>סריקות: <span className="text-slate-400">{formatNum(a.metrics?.scansPerformed)}</span></span>
                    <span>חסימות: <span className="text-slate-400">{formatNum(a.metrics?.blocksExecuted)}</span></span>
                    <span>תגובה:  <span className="text-slate-400">{a.metrics?.avgResponseTime ?? 0}ms</span></span>
                  </div>

                  {/* AI Brain Summary inline */}
                  {hasBrain ? (
                    <div className="border-t border-slate-800/60 pt-2">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Brain size={10} className="text-cyan-400/70" />
                        <span className="text-[10px] text-cyan-400/70 uppercase tracking-wider">ידע AI נרכש</span>
                        {b.lastScan && (
                          <span className="text-[9px] text-slate-600 mr-auto">
                            {new Date(b.lastScan).toLocaleString("he-IL")}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-[10px]">
                        {b.orgsFound > 0 && (
                          <span className="bg-purple-500/10 border border-purple-500/25 text-purple-300 px-2 py-0.5 rounded-full">
                            {b.orgsFound} ארגונים / לקוחות
                          </span>
                        )}
                        {b.personsFound > 0 && (
                          <span className="bg-blue-500/10 border border-blue-500/25 text-blue-300 px-2 py-0.5 rounded-full">
                            {b.personsFound} אנשים
                          </span>
                        )}
                        {b.piiFound > 0 && (
                          <span className="bg-red-500/10 border border-red-500/25 text-red-300 px-2 py-0.5 rounded-full">
                            {b.piiFound} רשומות PII
                          </span>
                        )}
                        {b.avgSensitivity > 0 && (
                          <span className="bg-yellow-500/10 border border-yellow-500/25 text-yellow-300 px-2 py-0.5 rounded-full">
                            רגישות ממוצעת {b.avgSensitivity}%
                          </span>
                        )}
                      </div>
                      {b.topOrgs?.length > 0 && (
                        <div className="mt-1.5 text-[9px] text-slate-500">
                          ארגונים: {b.topOrgs.slice(0, 5).join(" · ")}
                        </div>
                      )}
                    </div>
                  ) : a.syncStatus === "learning" ? (
                    <div className="border-t border-slate-800/60 pt-2 flex items-center gap-1.5 text-[10px] text-blue-400/70">
                      <Brain size={10} className="animate-pulse" />
                      <span>הסוכן לומד את תוכן הכונן — נתונים יופיעו בסיום הסריקה הראשונה</span>
                    </div>
                  ) : (
                    <div className="border-t border-slate-800/60 pt-2 flex items-center gap-1.5 text-[10px] text-slate-600">
                      <Brain size={10} />
                      <span>טרם נסרקו מסמכים</span>
                    </div>
                  )}

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

        {/* כתובת שרת DLP */}
        <div className="pt-2 border-t border-slate-800">
          <label className="block text-slate-400 mb-1.5">כתובת שרת DLP (לסוכן ולתוסף):</label>
          <div className="flex items-center gap-2">
            <input
              value={serverUrlEdit}
              onChange={(e) => setServerUrlEdit(e.target.value)}
              placeholder="https://dlp.company.com"
              dir="ltr"
              className="flex-1 bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono outline-none focus:border-cyan-600/60"
            />
            <button
              onClick={saveServerUrl}
              disabled={savingUrl}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-600/40 rounded-lg text-xs text-cyan-300 transition-colors disabled:opacity-40"
            >
              {savingUrl ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              שמור
            </button>
          </div>
          <label className="block text-slate-400 mt-3 mb-1.5">כתובת Local Agent (IP/URL):</label>
          <input
            value={agentUrlEdit}
            onChange={(e) => setAgentUrlEdit(e.target.value)}
            placeholder="http://10.0.0.50:4000"
            dir="ltr"
            className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono outline-none focus:border-cyan-600/60"
          />
          {urlSaveMsg && (
            <p className={`mt-1 text-[10px] ${urlSaveMsg.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>
              {urlSaveMsg}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
