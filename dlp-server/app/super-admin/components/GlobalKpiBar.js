"use client";

import { Building2, Cpu, ShieldOff, Activity } from "lucide-react";

function KpiCard({ icon: Icon, label, value, sub, color, glow }) {
  return (
    <div
      className={`relative flex flex-col gap-2 bg-[#0d0d14] border rounded-xl p-5 overflow-hidden ${color} ${glow}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400 uppercase tracking-widest">{label}</span>
        <Icon size={18} className="opacity-60" />
      </div>
      <span className="text-3xl font-bold font-mono tabular-nums">{value ?? "—"}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
      {/* subtle glow blob */}
      <div className="absolute -bottom-6 -right-6 w-24 h-24 rounded-full opacity-10 blur-2xl bg-current" />
    </div>
  );
}

export default function GlobalKpiBar({ stats }) {
  const health = stats?.systemHealth;
  const healthLabel =
    health?.status === "healthy" ? "תקין" :
    health?.status === "degraded" ? "מדורדר" : "קריטי";
  const healthColor =
    health?.status === "healthy" ? "text-green-400 border-green-900/40" :
    health?.status === "degraded" ? "text-yellow-400 border-yellow-900/40" :
    "text-red-400 border-red-900/40";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard
        icon={Building2}
        label="דיירים פעילים"
        value={stats?.activeTenants ?? 0}
        sub={`מתוך ${stats?.totalTenants ?? 0} סה"כ`}
        color="text-cyan-400 border-cyan-900/40"
        glow="shadow-[0_0_20px_rgba(34,211,238,0.05)]"
      />
      <KpiCard
        icon={Cpu}
        label="סוכנים פרוסים"
        value={stats?.onlineAgents ?? 0}
        sub={`מתוך ${stats?.totalAgents ?? 0} מחוברים`}
        color="text-purple-400 border-purple-900/40"
        glow="shadow-[0_0_20px_rgba(168,85,247,0.05)]"
      />
      <KpiCard
        icon={ShieldOff}
        label="חסימות היום"
        value={stats?.blocksToday ?? 0}
        sub={`${stats?.blocksWeek ?? 0} בשבוע / ${stats?.blocksMonth ?? 0} בחודש`}
        color="text-red-400 border-red-900/40"
        glow="shadow-[0_0_20px_rgba(248,113,113,0.05)]"
      />
      <KpiCard
        icon={Activity}
        label="בריאות המערכת"
        value={`${health?.score ?? 100}%`}
        sub={healthLabel}
        color={healthColor}
        glow=""
      />
    </div>
  );
}
