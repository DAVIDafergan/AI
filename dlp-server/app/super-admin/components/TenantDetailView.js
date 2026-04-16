"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Building2, ArrowLeft, Cpu, Activity, Terminal, Copy, CheckCheck,
  Server, Users, Plus, Loader2, Link, Shield, Trash2, Save, Wifi,
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
              {provError && <p className="text-xs text-red-400">{provError}</p>}
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
          headers: { "x-super-admin-key": superAdminKey },
        }),
        fetch(`/api/tenant-events?tenantId=${tenant._id}&limit=25`, {
          headers: { "x-super-admin-key": superAdminKey },
        }),
        fetch(`/api/tenant-users?tenantId=${tenant._id}`, {
          headers: { "x-super-admin-key": superAdminKey },
        }),
      ]);
      if (agentsRes.ok) setAgents((await agentsRes.json()).agents || []);
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
        headers: { "Content-Type": "application/json", "x-super-admin-key": superAdminKey },
        body: JSON.stringify({ serverUrl: serverUrlEdit, agentUrl: agentUrlEdit }),
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
        headers: { "x-super-admin-key": superAdminKey },
      });
      if (!res.ok) throw new Error((await res.json()).error || "שגיאה במחיקה");
      setAgents((prev) => prev.filter((a) => a._id !== agentId));
    } catch (e) {
      alert(`שגיאה במחיקת הסוכן: ${e.message}`);
    }
  };

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
