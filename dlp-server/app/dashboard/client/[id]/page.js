"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowRight, Building2, Cpu, Activity, Users,
  Copy, CheckCheck, RefreshCw, AlertTriangle, Circle,
  BookOpen, X, Terminal, AlertOctagon, ShieldAlert,
  Shield, LayoutDashboard, Network, HelpCircle,
} from "lucide-react";
import GhostLogo from "../../../../components/GhostLogo";

// ── Helpers ────────────────────────────────────────────────────
const STATUS_COLORS = {
  active:    "bg-green-500/20 text-green-400 border-green-700/40",
  trial:     "bg-blue-500/20 text-blue-400 border-blue-700/40",
  suspended: "bg-red-500/20 text-red-400 border-red-700/40",
  expired:   "bg-slate-500/20 text-slate-400 border-slate-700/40",
};

const STATUS_LABELS = {
  active:    "פעיל",
  trial:     "ניסיון",
  suspended: "מושהה",
  expired:   "פג תוקף",
};

const SEVERITY_COLORS = {
  critical: "text-red-400",
  high:     "text-orange-400",
  medium:   "text-yellow-400",
  low:      "text-green-400",
  info:     "text-blue-400",
};

const SEVERITY_BADGE = {
  critical: "bg-red-500/20 text-red-400 border border-red-700/40",
  high:     "bg-orange-500/20 text-orange-400 border border-orange-700/40",
  medium:   "bg-yellow-500/20 text-yellow-400 border border-yellow-700/40",
  low:      "bg-green-500/20 text-green-400 border border-green-700/40",
  info:     "bg-blue-500/20 text-blue-400 border border-blue-700/40",
};

const ACTION_BADGE = {
  block:   "bg-red-500/20 text-red-300 border border-red-600/40",
  scan:    "bg-cyan-500/20 text-cyan-300 border border-cyan-600/40",
  alert:   "bg-orange-500/20 text-orange-300 border border-orange-600/40",
  default: "bg-slate-500/20 text-slate-300 border border-slate-600/40",
};

const ACTION_LABELS = {
  block:            "BLOCKED",
  scan:             "MASKED",
  alert:            "ALERT",
  agent_connect:    "CONNECTED",
  agent_disconnect: "DISCONNECTED",
  config_change:    "CONFIG",
  user_action:      "USER",
};

/**
 * Extracts a host from a URL-like value.
 * Falls back to a lightweight protocol/path strip when URL parsing fails.
 * @param {string} url
 * @returns {string}
 */
function getHostFromUrl(url = "") {
  if (!url) return "";
  try {
    return new URL(url).hostname || "";
  } catch {
    return url.replace(/^https?:\/\//i, "").split("/")[0];
  }
}

/**
 * Validates whether a host string is a valid IPv4 address.
 * @param {string} host
 * @returns {boolean}
 */
function isValidIPv4(host = "") {
  return /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(host);
}

function ClientSidebar({ clientName, onBack }) {
  return (
    <aside className="hidden lg:flex lg:w-60 shrink-0 flex-col border-l border-slate-800 bg-slate-900/95">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
        <GhostLogo size={22} className="text-cyan-500 shrink-0" />
        <span className="text-cyan-300 font-bold text-sm tracking-widest whitespace-nowrap">GHOST</span>
      </div>
      <nav className="flex-1 px-3 py-5 space-y-2">
        <div className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
          <LayoutDashboard size={16} className="text-cyan-500" />
          <span className="truncate">Dashboard</span>
        </div>
        <div className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-300 bg-slate-800/50 border border-slate-700/50">
          <Network size={16} className="text-cyan-500" />
          <span className="truncate">{clientName}</span>
        </div>
      </nav>
      <div className="px-3 pb-4">
        <button
          onClick={onBack}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
        >
          <ArrowRight size={16} />
          חזרה ללוח הראשי
        </button>
      </div>
    </aside>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={handleCopy}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all ${
        copied
          ? "bg-green-500/20 text-green-400 border border-green-500/40"
          : "bg-slate-700/40 text-slate-400 border border-slate-600/40 hover:text-white hover:bg-slate-600/40"
      }`}
    >
      {copied ? <CheckCheck size={10} /> : <Copy size={10} />}
      {copied ? "הועתק" : "העתק"}
    </button>
  );
}

function KpiCard({ label, value, sub, colorClass = "text-cyan-300", icon: Icon }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-slate-500">{label}</p>
        {Icon && <Icon size={14} className="text-slate-600" />}
      </div>
      <p className={`text-2xl font-bold tabular-nums ${colorClass}`}>{value}</p>
      {sub && <p className="text-xs text-slate-600 mt-1">{sub}</p>}
    </div>
  );
}

// ── Connection Guide Modal ─────────────────────────────────────
function ConnectionModal({ client, onClose }) {
  const serverUrl = process.env.NEXT_PUBLIC_DLP_SERVER_URL || "<SERVER_URL>";
  const apiKey    = client?.apiKey || "<API_KEY>";
  const modalRef  = useRef(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const agentCmd = `npx ghostlayer-agent \\\n  --server-url=${serverUrl} \\\n  --api-key=${apiKey} \\\n  --dir=/company/docs \\\n  --verbose`;

  const steps = [
    {
      num: "01",
      title: "התקנת סוכן המקומי",
      desc: "הרץ פקודה זו על שרת הארגון או כל מחשב חברה:",
      code: agentCmd,
    },
    {
      num: "02",
      title: "התקנת תוסף Chrome",
      desc: "הורד את התוסף והתקן אותו בדפדפן הכרום של העובד.",
      code: `chrome://extensions → Load Unpacked → בחר תיקיית dlp-extension`,
    },
    {
      num: "03",
      title: "הגדרת התוסף",
      desc: "פתח את הגדרות התוסף (Options) ומלא את הפרטים:",
      items: [
        { label: "אימייל עובד", value: "your.name@company.com" },
        { label: "Local Agent URL", value: "http://localhost:4000" },
        { label: "Tenant API Key", value: apiKey },
      ],
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={handleBackdrop}
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0d1117] border border-cyan-900/40 rounded-2xl shadow-2xl shadow-cyan-900/20"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#0d1117] rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <BookOpen size={16} className="text-cyan-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Add Agent / Connection Guide</h2>
              <p className="text-xs text-slate-500 mt-0.5">מדריך חיבור סוכן ותוסף Chrome</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* API Key banner */}
        <div className="mx-6 mt-5 flex items-center gap-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl px-4 py-3">
          <Shield className="text-cyan-400 shrink-0" size={18} />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-400 mb-1">מפתח API של הארגון</p>
            <code className="text-xs text-cyan-300 font-mono truncate block" dir="ltr">{apiKey}</code>
          </div>
          <CopyButton text={apiKey} />
        </div>

        {/* Steps */}
        <div className="px-6 py-5 space-y-5">
          {steps.map((step) => (
            <div key={step.num} className="flex gap-4">
              <div className="shrink-0 w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
                <span className="text-xs font-bold text-cyan-400">{step.num}</span>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-white mb-1">{step.title}</h3>
                <p className="text-xs text-slate-400 mb-2">{step.desc}</p>
                {step.code && (
                  <div className="relative group">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-slate-600 font-mono">bash</span>
                      <CopyButton text={step.code} />
                    </div>
                    <pre className="text-xs text-green-300 font-mono bg-slate-900/80 border border-slate-700/60 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all" dir="ltr">
                      {step.code}
                    </pre>
                  </div>
                )}
                {step.items && (
                  <div className="space-y-2">
                    {step.items.map((item) => (
                      <div key={item.label} className="flex items-center gap-2 bg-slate-900/60 border border-slate-700/40 rounded-lg px-3 py-2">
                        <span className="text-xs text-slate-500 w-28 shrink-0">{item.label}:</span>
                        <code className="text-xs text-cyan-300 font-mono flex-1 truncate" dir="ltr">{item.value}</code>
                        <CopyButton text={item.value} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5">
          <div className="flex items-center gap-2 text-xs text-slate-600 bg-slate-900/40 border border-slate-800 rounded-lg px-3 py-2">
            <Shield size={12} className="text-green-500 shrink-0" />
            כל עיבוד הנתונים מתבצע מקומית. שום תוכן רגיש לא נשלח לענן.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Active Employees Widget ────────────────────────────────────
function ActiveEmployeesWidget({ events }) {
  const employeeMap = new Map();
  for (const ev of events) {
    const email = ev.userEmail;
    if (!email || email === "unknown" || email === "system") continue;
    const prev = employeeMap.get(email);
    const ts   = new Date(ev.timestamp).getTime();
    if (!prev || ts > prev.lastSeen) {
      employeeMap.set(email, { email, lastSeen: ts, blocked: (prev?.blocked || 0) + (ev.eventType === "block" ? 1 : 0) });
    } else {
      employeeMap.set(email, { ...prev, blocked: prev.blocked + (ev.eventType === "block" ? 1 : 0) });
    }
  }
  const employees = [...employeeMap.values()].sort((a, b) => b.lastSeen - a.lastSeen);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Users size={14} className="text-cyan-400" />
          <h3 className="text-sm text-slate-300 font-medium">עובדים פעילים</h3>
        </div>
        <span className="text-xs text-slate-600">{employees.length} עובדים</span>
      </div>

      {employees.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <Users size={28} className="text-slate-700 mx-auto mb-2" />
          <p className="text-xs text-slate-600">אין נתוני עובדים עדיין</p>
          <p className="text-[10px] text-slate-700 mt-1">יופיעו לאחר שעובדים יתחברו עם התוסף</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-800/60">
          {employees.slice(0, 8).map((emp) => (
            <div key={emp.email} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/20 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                  <span className="text-[9px] font-bold text-cyan-400">{emp.email[0].toUpperCase()}</span>
                </div>
                <span className="text-xs text-slate-300 font-mono truncate">{emp.email}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {emp.blocked > 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-700/40 font-medium">
                    {emp.blocked} חסימות
                  </span>
                )}
                <span className="text-[9px] text-slate-600">
                  {new Date(emp.lastSeen).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────
export default function ClientDetailPage() {
  const { id } = useParams();
  const router  = useRouter();
  const [client, setClient]               = useState(null);
  const [events, setEvents]               = useState([]);
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [showGuide, setShowGuide]         = useState(false);

  const loadClient = useCallback(async () => {
    try {
      const res = await fetch(`/api/tenants/${id}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setClient(data.tenant || data);
        return;
      }
    } catch {}
  }, [id]);

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetch(`/api/tenant-events?tenantId=${id}&limit=50`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.events?.length) { setEvents(data.events); return; }
      }
    } catch {}
    setEvents([]);
  }, [id]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadClient(), loadEvents()]).finally(() => setLoading(false));
    const interval = setInterval(() => { loadClient(); loadEvents(); }, 20000);
    return () => clearInterval(interval);
  }, [loadClient, loadEvents]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadClient(), loadEvents()]);
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <RefreshCw size={18} className="animate-spin text-cyan-400" />
          <span className="text-sm">טוען נתוני לקוח...</span>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div dir="rtl" className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <AlertTriangle size={40} className="text-yellow-400 mx-auto" />
          <p className="text-slate-300 text-sm">לקוח לא נמצא</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="px-4 py-2 bg-cyan-500/20 border border-cyan-600/40 rounded-lg text-sm text-cyan-300 hover:bg-cyan-500/30 transition-colors"
          >
            חזרה ללוח הבקרה
          </button>
        </div>
      </div>
    );
  }

  const isConnected     = client.status === "active";
  const threatEvents    = events.filter((e) => e.eventType === "block" || e.eventType === "alert");
  const blocksCount     = events.filter((e) => e.eventType === "block").length;
  const uniqueEmployees = new Set(events.map((e) => e.userEmail).filter((e) => e && e !== "unknown" && e !== "system")).size;

  // ── Evasion metrics derived from event details ──────────────────────────────
  const evasionEvents   = events.filter((e) => e.details?.evasionTechniques?.length > 0);
  const evasionCount    = evasionEvents.length;
  const fragmentEvents  = events.filter((e) => {
    const tier = e.details?.detectionTier || "";
    const flags = e.details?.anomalyFlags || [];
    return tier === "fragment" || tier.startsWith("evasion+fragment") ||
      flags.includes("FRAGMENTATION_PATTERN");
  });
  const roleplayEvents  = events.filter((e) => e.details?.evasionTechniques?.includes("ROLEPLAY_INJECTION"));

  // Aggregate evasion technique counts
  const techniqueCounts = {};
  for (const ev of evasionEvents) {
    for (const tech of (ev.details?.evasionTechniques || [])) {
      techniqueCounts[tech] = (techniqueCounts[tech] || 0) + 1;
    }
  }
  const topTechniques = Object.entries(techniqueCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const agentEndpoint = client.serverUrl || "לא הוגדר";
  const agentHost = client.serverUrl ? getHostFromUrl(client.serverUrl) : "";
  const looksLikeIPv4 = /^[\d.]+$/.test(agentHost);
  const invalidIpFormat = Boolean(agentHost) && looksLikeIPv4 && !isValidIPv4(agentHost);

  return (
    <div dir="rtl" className="min-h-screen bg-slate-900 text-white">
      {/* Connection Guide Modal */}
      {showGuide && <ConnectionModal client={client} onClose={() => setShowGuide(false)} />}

      <div className="flex min-h-screen">
        <ClientSidebar clientName={client.name} onBack={() => router.push("/dashboard")} />
        <div className="flex-1">
          {/* Top bar */}
          <header className="flex flex-wrap items-center justify-between gap-3 px-6 lg:px-8 py-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push("/dashboard")}
                className="lg:hidden flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors text-sm"
              >
                <ArrowRight size={16} />
                <span>חזרה</span>
              </button>
              <span className="text-slate-700 lg:hidden">/</span>
              <div className="flex items-center gap-2">
                <GhostLogo size={16} className="text-cyan-500" />
                <span className="text-sm font-bold text-cyan-300 tracking-widest">GHOST</span>
              </div>
              <span className="text-slate-700">/</span>
              <span className="text-sm text-slate-300 font-medium">{client.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowGuide(true)}
                className="flex items-center gap-2 px-4 py-2 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 rounded-lg text-xs font-semibold text-cyan-300 hover:text-cyan-100 transition-all shadow-[0_0_12px_rgba(34,211,238,0.15)]"
              >
                <BookOpen size={13} />
                Add Agent / Connection Guide
              </button>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-2 px-3 py-2 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/40 rounded-lg text-xs text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
              >
                <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
                רענן
              </button>
            </div>
          </header>

          <main className="p-6 lg:p-8 space-y-8 max-w-7xl mx-auto">
        {/* Client header card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                <Building2 className="text-cyan-400" size={24} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">{client.name}</h1>
                <p className="text-slate-400 text-sm mt-0.5">{client.contactEmail || "—"}</p>
                <p className="text-slate-600 text-xs mt-1 font-mono">{client.slug || client._id}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${STATUS_COLORS[client.status] || STATUS_COLORS.trial}`}>
                <Circle size={6} fill="currentColor" />
                {STATUS_LABELS[client.status] || client.status}
              </span>
              <span className="text-xs text-slate-500 px-2 py-1 bg-slate-800/60 rounded-lg border border-slate-700/40">{client.plan}</span>
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <KpiCard
            label="סוכנים פעילים"
            value={client.agentCount ?? 0}
            colorClass={isConnected ? "text-green-400" : "text-slate-400"}
            icon={Cpu}
          />
          <KpiCard
            label="סריקות סה״כ"
            value={(client.usage?.totalScans ?? 0).toLocaleString("he-IL")}
            colorClass="text-cyan-300"
            icon={Activity}
          />
          <KpiCard
            label="חסימות (Live Feed)"
            value={blocksCount.toLocaleString("he-IL")}
            colorClass="text-red-400"
            icon={ShieldAlert}
          />
          <KpiCard
            label="עובדים מזוהים"
            value={uniqueEmployees}
            colorClass="text-purple-400"
            icon={Users}
          />
        </div>

        {/* ── Evasion Detection Panel ──────────────────────────────────────── */}
        {(evasionCount > 0 || fragmentEvents.length > 0 || roleplayEvents.length > 0) && (
          <div className="bg-slate-900 border border-orange-700/30 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 bg-gradient-to-r from-orange-900/10 to-transparent">
              <AlertTriangle size={14} className="text-orange-400" />
              <h3 className="text-sm text-slate-200 font-semibold">ניסיונות הטעיה – Evasion Shield</h3>
              <span className="relative flex h-2 w-2 ml-1">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
              </span>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Technique counter cards */}
              <div className="bg-slate-900/40 border border-slate-700/40 rounded-lg p-3 space-y-1">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">ניסיונות הטעיה</p>
                <p className="text-2xl font-bold text-orange-400 tabular-nums">{evasionCount}</p>
                <p className="text-[10px] text-slate-600">אירועים עם טכניקת עקיפה</p>
              </div>
              <div className="bg-slate-900/40 border border-slate-700/40 rounded-lg p-3 space-y-1">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">התקפות פיצול</p>
                <p className="text-2xl font-bold text-yellow-400 tabular-nums">{fragmentEvents.length}</p>
                <p className="text-[10px] text-slate-600">זיהוי מידע מפוצל (Fragment Memory)</p>
              </div>
              <div className="bg-slate-900/40 border border-slate-700/40 rounded-lg p-3 space-y-1">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">Roleplay / Jailbreak</p>
                <p className="text-2xl font-bold text-red-400 tabular-nums">{roleplayEvents.length}</p>
                <p className="text-[10px] text-slate-600">ניסיונות הנדסה חברתית</p>
              </div>
            </div>
            {/* Top techniques breakdown */}
            {topTechniques.length > 0 && (
              <div className="px-4 pb-4">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">טכניקות נפוצות</p>
                <div className="flex flex-wrap gap-2">
                  {topTechniques.map(([tech, count]) => (
                    <span key={tech} className="inline-flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full bg-orange-500/10 text-orange-300 border border-orange-700/30 font-mono">
                      {tech}
                      <span className="bg-orange-600/30 px-1 rounded text-[9px] tabular-nums">{count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Control Room: Live Threat Feed + Active Employees */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* ── Live Threat Feed ───────────────────────── */}
          <div className="xl:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-gradient-to-r from-red-900/10 to-transparent">
              <div className="flex items-center gap-2">
                <AlertOctagon size={14} className="text-red-400" />
                <h3 className="text-sm text-slate-200 font-semibold">Live Threat Feed</h3>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
              </div>
              <span className="text-xs text-slate-600">{events.length} אירועים</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="px-4 py-2.5 text-right text-[10px] text-slate-500 uppercase tracking-wider">פעולה</th>
                    <th className="px-4 py-2.5 text-right text-[10px] text-slate-500 uppercase tracking-wider">עובד</th>
                    <th className="px-4 py-2.5 text-right text-[10px] text-slate-500 uppercase tracking-wider">ישויות שזוהו</th>
                    <th className="px-4 py-2.5 text-right text-[10px] text-slate-500 uppercase tracking-wider">הטעיה</th>
                    <th className="px-4 py-2.5 text-right text-[10px] text-slate-500 uppercase tracking-wider">חומרה</th>
                    <th className="px-4 py-2.5 text-right text-[10px] text-slate-500 uppercase tracking-wider">זמן</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {events.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center">
                        <Shield size={28} className="text-slate-700 mx-auto mb-2" />
                        <p className="text-xs text-slate-600">אין אירועים עדיין</p>
                        <p className="text-[10px] text-slate-700 mt-1">יופיעו כאן בזמן אמת לאחר חיבור הסוכן</p>
                      </td>
                    </tr>
                  ) : (
                    events.map((ev) => {
                      const actionKey = ev.eventType || "default";
                      const matchedEntities = ev.details?.matchedEntities;
                      const evTechniques = ev.details?.evasionTechniques || [];
                      return (
                        <tr key={ev._id} className={`hover:bg-slate-800/20 transition-colors ${evTechniques.length > 0 ? "bg-orange-900/5" : ""}`}>
                          <td className="px-4 py-3">
                            <span className={`inline-block text-[10px] font-bold px-2 py-1 rounded ${ACTION_BADGE[actionKey] || ACTION_BADGE.default}`}>
                              {ACTION_LABELS[actionKey] || actionKey.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-300 font-mono text-xs max-w-[180px] truncate">
                            {ev.userEmail || "—"}
                          </td>
                          <td className="px-4 py-3">
                            {matchedEntities?.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {matchedEntities.slice(0, 3).map((ent) => (
                                  <span key={ent} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 border border-slate-600/40 font-mono">
                                    {ent}
                                  </span>
                                ))}
                                {matchedEntities.length > 3 && (
                                  <span className="text-[9px] text-slate-600">+{matchedEntities.length - 3}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {evTechniques.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {evTechniques.slice(0, 2).map((tech) => (
                                  <span key={tech} className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-700/40 font-mono">
                                    {tech.replace(/_/g, " ")}
                                  </span>
                                ))}
                                {evTechniques.length > 2 && (
                                  <span className="text-[9px] text-orange-600">+{evTechniques.length - 2}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-700">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${SEVERITY_BADGE[ev.severity] || SEVERITY_BADGE.info}`}>
                              {ev.severity || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-600 text-[10px] whitespace-nowrap">
                            {ev.timestamp ? new Date(ev.timestamp).toLocaleString("he-IL") : "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Active Employees + Connectivity ────── */}
          <div className="space-y-4">
            <ActiveEmployeesWidget events={events} />

            {/* Connectivity card */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs text-slate-400 uppercase tracking-wider">Connectivity</h3>
                <div className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                  isConnected
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-slate-700 bg-slate-800/70 text-slate-400"
                }`}>
                  {isConnected ? (
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                    </span>
                  ) : (
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                  )}
                  <span>Status: {isConnected ? "Active" : "Disconnected"}</span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] text-slate-500">Agent Endpoint</p>
                <div className="flex items-center gap-2 bg-slate-950/60 border border-slate-700/70 rounded-lg px-3 py-2">
                  <code className="flex-1 text-xs text-cyan-300 font-mono truncate" dir="ltr">{agentEndpoint}</code>
                  {client.serverUrl && <CopyButton text={client.serverUrl} />}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <p className="text-[11px] text-slate-500">Agent IP / Host</p>
                  {invalidIpFormat && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] text-red-300"
                      title="Help: Use valid IPv4 format (example: 192.168.1.20)"
                    >
                      <HelpCircle size={12} className="text-red-400" />
                      Help
                    </span>
                  )}
                </div>
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${
                  invalidIpFormat
                    ? "bg-red-950/20 border-red-500/40"
                    : "bg-slate-950/60 border-slate-700/70"
                }`}>
                  <code className={`text-xs font-mono truncate ${invalidIpFormat ? "text-red-300" : "text-slate-300"}`} dir="ltr">
                    {agentHost || "לא הוגדר"}
                  </code>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] text-slate-500">Tenant API Key</p>
                <div className="flex items-center gap-2 bg-slate-950/60 border border-slate-700/70 rounded-lg px-3 py-2">
                  <code className="flex-1 text-xs text-cyan-300 font-mono truncate" dir="ltr">
                    {client.apiKey || "לא הוגדר"}
                  </code>
                  {client.apiKey && <CopyButton text={client.apiKey} />}
                </div>
              </div>
            </div>
          </div>
        </div>
          </main>
        </div>
      </div>
    </div>
  );
}
