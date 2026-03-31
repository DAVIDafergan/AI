"use client";

/**
 * app/admin/page.js
 *
 * GhostLayer – Command Center Dashboard
 * ──────────────────────────────────────
 * Phase 1: Server Brain Connection  (AI RAG pipeline telemetry)
 * Phase 2: Worker Shield Deployment (endpoint agent management)
 */

import { useState, useEffect, useRef } from "react";
import {
  Shield, Brain, Cpu, Server, Download, Copy, CheckCheck,
  Activity, Users, Zap, Lock, Eye, ChevronRight,
  Terminal, AlertCircle, Wifi,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

function clsx(...cls) {
  return cls.filter(Boolean).join(" ");
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatNumber(n) {
  return n.toLocaleString("en-US");
}

// ─────────────────────────────────────────────────────────────────────────────
// Pulsing "live" dot
// ─────────────────────────────────────────────────────────────────────────────

function LiveDot({ color = "bg-green-500" }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className={clsx("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", color)} />
      <span className={clsx("relative inline-flex rounded-full h-2.5 w-2.5", color)} />
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy-to-clipboard button
// ─────────────────────────────────────────────────────────────────────────────

function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className={clsx(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200",
        copied
          ? "bg-green-500/20 text-green-400 border border-green-500/40"
          : "bg-slate-700/60 text-slate-300 border border-slate-600/50 hover:bg-slate-600/60 hover:text-white"
      )}
    >
      {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied!" : label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress bar
// ─────────────────────────────────────────────────────────────────────────────

function ProgressBar({ value, color = "bg-cyan-500", className = "" }) {
  return (
    <div className={clsx("w-full bg-slate-800 rounded-full h-2 overflow-hidden", className)}>
      <div
        className={clsx("h-full rounded-full transition-all duration-700 ease-in-out", color)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric card
// ─────────────────────────────────────────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, sub, color = "text-cyan-400", border = "border-cyan-500/20" }) {
  return (
    <div className={clsx("bg-slate-900/60 border rounded-xl p-4 flex items-start gap-3", border)}>
      <div className={clsx("p-2 rounded-lg bg-slate-800/80", color.replace("text-", "text-").replace("400", "500/10"))}>
        <Icon className={clsx("w-4 h-4", color)} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 truncate">{label}</p>
        <p className={clsx("text-lg font-bold mt-0.5", color)}>{value}</p>
        {sub && <p className="text-xs text-slate-600 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 – Server Brain Connection
// ─────────────────────────────────────────────────────────────────────────────

function DEMO_TENANT_KEY() {
  // Deterministic key derived from hostname + date (demo purposes)
  const seed = typeof window !== "undefined" ? window.location.hostname : "localhost";
  const ts   = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `GL-${ts}-${seed.slice(0, 4).toUpperCase().padEnd(4, "X")}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

function ServerBrainPhase() {
  const tenantKey   = useRef(null);
  const [key, setKey] = useState("");

  useEffect(() => {
    if (!tenantKey.current) tenantKey.current = DEMO_TENANT_KEY();
    setKey(tenantKey.current);
  }, []);

  const command = `npx ghostlayer-agent --api-key=${key} --dir=/company/docs --verbose`;

  // ── Simulated real-time telemetry ─────────────────────────────────────────
  const [connected,       setConnected]       = useState(false);
  const [status,          setStatus]          = useState("Awaiting server agent…");
  const [filesProcessed,  setFilesProcessed]  = useState(0);
  const [totalFiles,      setTotalFiles]      = useState(5000);
  const [vectorsLearned,  setVectorsLearned]  = useState(0);
  const [brainProgress,   setBrainProgress]   = useState(0);
  const [layerStatus,     setLayerStatus]     = useState({ l1: "idle", l2: "idle", l3: "idle" });

  const STATUSES = [
    "Scanning infrastructure…",
    "Building Bloom filter index…",
    "Extracting PII patterns…",
    "Embedding document chunks…",
    "Populating vector store…",
    "Training semantic similarity model…",
    "Calibrating sensitivity thresholds…",
    "Ghost-masking engine ready",
  ];

  useEffect(() => {
    // Simulate agent connecting after 1.5 s
    const connectTimer = setTimeout(() => setConnected(true), 1500);
    return () => clearTimeout(connectTimer);
  }, []);

  useEffect(() => {
    if (!connected) return;

    let statusIdx = 0;
    const iv = setInterval(() => {
      setFilesProcessed((p) => Math.min(totalFiles, p + randomBetween(40, 120)));
      setVectorsLearned((v) => v + randomBetween(80, 250));
      setBrainProgress((b) => {
        const next = Math.min(100, b + randomBetween(1, 3));
        return next;
      });
      setStatus(STATUSES[Math.min(statusIdx++, STATUSES.length - 1)]);
      setLayerStatus({
        l1: statusIdx >= 2 ? "active" : "idle",
        l2: statusIdx >= 4 ? "active" : "idle",
        l3: statusIdx >= 6 ? "active" : "idle",
      });
    }, 800);

    return () => clearInterval(iv);
  }, [connected, totalFiles]);

  const layerColor = (s) =>
    s === "active" ? "bg-green-500/20 text-green-400 border-green-500/30"
                   : "bg-slate-800/50 text-slate-600 border-slate-700/30";

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-cyan-500/10 rounded-xl border border-cyan-500/20">
          <Server className="w-6 h-6 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">Phase 1 — Connect Server Brain</h2>
          <p className="text-sm text-slate-400">Run this one command on your on-premise server to activate the AI engine</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {connected
            ? <><LiveDot color="bg-green-500" /><span className="text-xs text-green-400 font-medium">Agent connected</span></>
            : <><LiveDot color="bg-yellow-500" /><span className="text-xs text-yellow-400 font-medium">Waiting for agent…</span></>}
        </div>
      </div>

      {/* Terminal command */}
      <div className="bg-slate-950 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/80 border-b border-slate-700/50">
          <div className="flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs text-slate-500 font-medium">Terminal – run on your company server</span>
          </div>
          <CopyButton text={command} label="Copy command" />
        </div>
        <div className="px-5 py-4 overflow-x-auto">
          <code className="text-sm text-green-400 font-mono whitespace-nowrap">
            <span className="text-slate-600 select-none">$ </span>
            {command}
          </code>
        </div>
        <div className="px-5 pb-3 flex items-center gap-2">
          <span className="text-xs text-slate-600">Your Tenant API Key:</span>
          <code className="text-xs text-cyan-400 font-mono bg-slate-800/60 px-2 py-0.5 rounded">{key}</code>
          <CopyButton text={key} label="Copy key" />
        </div>
      </div>

      {/* Triage layer status pills */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { id: "l1", label: "L1 – Bloom Filter", sub: "<1 ms", icon: Zap },
          { id: "l2", label: "L2 – PII Regex",    sub: "<5 ms", icon: Eye },
          { id: "l3", label: "L3 – Semantic RAG",  sub: "async", icon: Brain },
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

      {/* Live telemetry panel */}
      <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">Real-Time Brain Telemetry</span>
          {connected && <LiveDot color="bg-cyan-500" />}
        </div>

        {/* Status line */}
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-sm text-cyan-300 font-medium">{connected ? status : "Awaiting connection…"}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <MetricCard
            icon={Cpu}
            label="Files Processed"
            value={`${formatNumber(filesProcessed)} / ${formatNumber(totalFiles)}`}
            sub="local documents scanned"
            color="text-cyan-400"
            border="border-cyan-500/20"
          />
          <MetricCard
            icon={Brain}
            label="Sensitive Vectors Learned"
            value={formatNumber(vectorsLearned)}
            sub="high-dimensional embeddings stored"
            color="text-purple-400"
            border="border-purple-500/20"
          />
        </div>

        {/* Brain training progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 font-medium">Brain Training Progress</span>
            <span className="text-cyan-400 font-bold">{brainProgress}%</span>
          </div>
          <ProgressBar value={brainProgress} color="bg-gradient-to-r from-cyan-600 to-purple-600" />
        </div>

        {connected && brainProgress >= 95 && (
          <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-2.5">
            <Shield className="w-4 h-4 text-green-400" />
            <span className="text-sm text-green-300 font-medium">RAG pipeline fully operational — Ghost-Masking engine armed</span>
          </div>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 – Worker Shield Deployment
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_FLEET = [
  { id: 1, name: "David's MacBook Pro",     os: "macOS",   status: "active",  lastSeen: "now",     blocked: 14 },
  { id: 2, name: "Marketing-WIN-PC-07",     os: "Windows", status: "active",  lastSeen: "1m ago",  blocked: 3  },
  { id: 3, name: "Sarah's MacBook Air",     os: "macOS",   status: "active",  lastSeen: "2m ago",  blocked: 7  },
  { id: 4, name: "Dev-LINUX-BUILD-01",      os: "Linux",   status: "active",  lastSeen: "now",     blocked: 1  },
  { id: 5, name: "Finance-WIN-PC-12",       os: "Windows", status: "warning", lastSeen: "8m ago",  blocked: 22 },
  { id: 6, name: "HR-WIN-LAPTOP-03",        os: "Windows", status: "active",  lastSeen: "3m ago",  blocked: 5  },
  { id: 7, name: "CTO-MacBook-Pro-M3",      os: "macOS",   status: "active",  lastSeen: "now",     blocked: 0  },
  { id: 8, name: "Design-WIN-PC-09",        os: "Windows", status: "offline", lastSeen: "2h ago",  blocked: 0  },
];

const OS_ICONS = {
  macOS   : "🍎",
  Windows : "🪟",
  Linux   : "🐧",
};

const STATUS_STYLE = {
  active  : "bg-green-500/15 text-green-400  border-green-500/25",
  warning : "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
  offline : "bg-slate-700/40 text-slate-500   border-slate-600/30",
};

function WorkerShieldPhase() {
  const [activeTab, setActiveTab] = useState("downloads");
  const [fleet, setFleet]         = useState(DEMO_FLEET);

  // Simulate live fleet updates
  useEffect(() => {
    const iv = setInterval(() => {
      setFleet((prev) =>
        prev.map((e) =>
          e.status === "active" && Math.random() > 0.85
            ? { ...e, blocked: e.blocked + 1, lastSeen: "now" }
            : e
        )
      );
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  const deployScript =
`# GhostLayer – Mass Deployment Script (Intune / Jamf / GPO)
# ──────────────────────────────────────────────────────────
# Windows (Intune / PowerShell):
$GL_KEY = "GL-TENANT-KEY-HERE"
Invoke-WebRequest -Uri "https://releases.ghostlayer.ai/shield/latest/win/GhostLayerShield.exe" -OutFile "$env:TEMP\\GhostLayerShield.exe"
Start-Process "$env:TEMP\\GhostLayerShield.exe" -ArgumentList "/S /KEY=$GL_KEY" -Wait

# macOS (Jamf / shell):
GL_KEY="GL-TENANT-KEY-HERE"
curl -fsSL "https://releases.ghostlayer.ai/shield/latest/mac/GhostLayerShield.dmg" -o /tmp/GhostLayerShield.dmg
hdiutil attach /tmp/GhostLayerShield.dmg -nobrowse -quiet
sudo installer -pkg /Volumes/GhostLayerShield/GhostLayerShield.pkg -target / -key "$GL_KEY"
hdiutil detach /Volumes/GhostLayerShield -quiet`;

  const downloads = [
    { label: "Windows Shield",  ext: ".exe", icon: "🪟", color: "bg-blue-500/10  border-blue-500/25  text-blue-400",   size: "18.4 MB" },
    { label: "macOS Shield",    ext: ".dmg", icon: "🍎", color: "bg-slate-700/30 border-slate-600/40 text-slate-300",  size: "21.1 MB" },
    { label: "Chrome Extension",ext: ".crx", icon: "🌐", color: "bg-yellow-500/10 border-yellow-500/25 text-yellow-400", size: "3.2 MB"  },
  ];

  const tabs = [
    { id: "downloads",    label: "Download Shields" },
    { id: "mass-deploy",  label: "Mass Deploy Script" },
    { id: "fleet",        label: `Fleet Tracking (${fleet.filter(f => f.status === "active").length} active)` },
  ];

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-purple-500/10 rounded-xl border border-purple-500/20">
          <Users className="w-6 h-6 text-purple-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">Phase 2 — Deploy Worker Shields</h2>
          <p className="text-sm text-slate-400">Protect every employee endpoint in minutes — no tech knowledge required</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <LiveDot color="bg-purple-500" />
          <span className="text-xs text-purple-400 font-medium">{fleet.filter(f => f.status === "active").length} shields active</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-900/60 rounded-xl p-1 border border-slate-700/40">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={clsx(
              "flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all duration-200",
              activeTab === t.id
                ? "bg-purple-600/25 text-purple-300 border border-purple-500/30"
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Downloads tab */}
      {activeTab === "downloads" && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Click to download the Shield installer for each platform. Run the installer on the employee's machine — it auto-registers with your tenant key.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {downloads.map(({ label, ext, icon, color, size }) => (
              <button
                key={ext}
                className={clsx(
                  "flex flex-col items-center gap-3 rounded-xl border px-4 py-6 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/30 active:scale-100",
                  color
                )}
              >
                <span className="text-4xl">{icon}</span>
                <div className="text-center">
                  <p className="font-semibold text-sm">{label}</p>
                  <p className="text-[11px] opacity-60 mt-0.5">{size} · {ext}</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium mt-1">
                  <Download className="w-3.5 h-3.5" />
                  Download
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mass deploy tab */}
      {activeTab === "mass-deploy" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">
            Copy this script and paste it into <strong className="text-white">Intune (Windows)</strong> or{" "}
            <strong className="text-white">Jamf (macOS)</strong> to silently deploy shields across your entire fleet.
          </p>
          <div className="bg-slate-950 border border-slate-700/50 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/80 border-b border-slate-700/50">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-xs text-slate-500 font-medium">PowerShell / Bash – paste into Intune or Jamf</span>
              </div>
              <CopyButton text={deployScript} label="Copy script" />
            </div>
            <pre className="px-5 py-4 text-xs text-green-300 font-mono overflow-x-auto leading-relaxed whitespace-pre">
              {deployScript}
            </pre>
          </div>
        </div>
      )}

      {/* Fleet tracking tab */}
      {activeTab === "fleet" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-semibold text-white">Protected Endpoints</span>
            <LiveDot color="bg-purple-500" />
            <span className="text-xs text-slate-500">Live</span>
          </div>
          <div className="bg-slate-900/50 border border-slate-700/40 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50 text-xs text-slate-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Endpoint</th>
                  <th className="text-left px-4 py-3 hidden sm:table-cell">OS</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">Blocks</th>
                  <th className="text-right px-4 py-3 hidden lg:table-cell">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {fleet.map((e, i) => (
                  <tr
                    key={e.id}
                    className={clsx(
                      "border-b border-slate-800/60 transition-colors",
                      i % 2 === 0 ? "bg-slate-900/20" : "bg-transparent",
                      e.status === "warning" && "bg-yellow-500/5"
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-white flex items-center gap-2">
                      <span>{OS_ICONS[e.os] || "💻"}</span>
                      <span className="truncate max-w-[160px]">{e.name}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 hidden sm:table-cell">{e.os}</td>
                    <td className="px-4 py-3">
                      <span className={clsx("text-xs font-medium px-2 py-0.5 rounded-full border", STATUS_STYLE[e.status])}>
                        {e.status === "active" ? "🛡 Active" : e.status === "warning" ? "⚠ Warning" : "○ Offline"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400 hidden md:table-cell">
                      {e.blocked > 0
                        ? <span className="text-rose-400 font-semibold">{e.blocked}</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 text-xs hidden lg:table-cell">{e.lastSeen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level KPI strip
// ─────────────────────────────────────────────────────────────────────────────

function KpiStrip() {
  const [kpis, setKpis] = useState({ blocked: 1842, threats: 94, endpoints: 8, vectors: 48920 });

  useEffect(() => {
    const iv = setInterval(() => {
      setKpis((k) => ({
        ...k,
        blocked : k.blocked  + randomBetween(0, 2),
        threats : k.threats  + randomBetween(0, 1),
        vectors : k.vectors  + randomBetween(50, 200),
      }));
    }, 2500);
    return () => clearInterval(iv);
  }, []);

  const items = [
    { icon: Lock,     label: "Total Blocks",           value: formatNumber(kpis.blocked),  color: "text-rose-400",   border: "border-rose-500/20" },
    { icon: AlertCircle, label: "Threats Intercepted", value: formatNumber(kpis.threats),  color: "text-orange-400", border: "border-orange-500/20" },
    { icon: Wifi,     label: "Protected Endpoints",    value: kpis.endpoints,              color: "text-purple-400", border: "border-purple-500/20" },
    { icon: Brain,    label: "Vectors in Brain",       value: formatNumber(kpis.vectors),  color: "text-cyan-400",   border: "border-cyan-500/20" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map(({ icon: Icon, label, value, color, border }) => (
        <MetricCard key={label} icon={Icon} label={label} value={value} color={color} border={border} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main dashboard
// ─────────────────────────────────────────────────────────────────────────────

export default function CommandCenterDashboard() {
  const [time, setTime] = useState("");

  useEffect(() => {
    function tick() {
      setTime(new Date().toLocaleTimeString("en-US", { hour12: false }));
    }
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="min-h-screen bg-[#030712] text-white">
      {/* Top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-6 py-3 bg-[#030712]/90 backdrop-blur border-b border-slate-800/60">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-cyan-500/10 rounded-lg border border-cyan-500/20">
            <Shield className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-bold text-base tracking-tight text-white">GhostLayer</span>
            <span className="text-xs text-slate-500 font-medium tracking-widest uppercase">Command Center</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <LiveDot color="bg-green-500" />
            <span className="text-xs text-green-400 font-medium hidden sm:inline">System Operational</span>
          </div>
          <code className="text-xs text-slate-500 font-mono hidden md:block">{time}</code>
        </div>
      </header>

      {/* Page content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">

        {/* Hero headline */}
        <div className="text-center space-y-2 pt-2">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            <span className="text-white">Deploy</span>{" "}
            <span className="bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">GhostLayer</span>{" "}
            <span className="text-white">in Minutes</span>
          </h1>
          <p className="text-slate-400 text-base max-w-xl mx-auto">
            Two steps. Zero-trust AI data-loss prevention — no vendor access, no data leaves your network.
          </p>
        </div>

        {/* Live KPI strip */}
        <KpiStrip />

        {/* Divider with step labels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[
            { num: "01", label: "Connect Server Brain",    color: "border-cyan-500/30   bg-cyan-500/5" },
            { num: "02", label: "Deploy Worker Shields",   color: "border-purple-500/30 bg-purple-500/5" },
          ].map(({ num, label, color }) => (
            <div key={num} className={clsx("flex items-center gap-3 rounded-xl border px-5 py-3", color)}>
              <span className="text-2xl font-black text-white/20">{num}</span>
              <ChevronRight className="w-4 h-4 text-slate-600" />
              <span className="font-semibold text-white text-sm">{label}</span>
            </div>
          ))}
        </div>

        {/* Phase 1 */}
        <div className="bg-slate-900/40 border border-slate-700/40 rounded-2xl p-6 lg:p-8 shadow-xl shadow-black/20">
          <ServerBrainPhase />
        </div>

        {/* Phase 2 */}
        <div className="bg-slate-900/40 border border-slate-700/40 rounded-2xl p-6 lg:p-8 shadow-xl shadow-black/20">
          <WorkerShieldPhase />
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-slate-700 pb-6">
          GhostLayer processes all sensitive data locally. No plaintext ever reaches external LLMs or third-party servers.
        </p>
      </main>
    </div>
  );
}
