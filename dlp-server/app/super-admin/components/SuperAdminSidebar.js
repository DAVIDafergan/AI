"use client";

import { useState } from "react";
import {
  LayoutDashboard, Building2, Cpu, Activity,
  Map, Radio, ChevronLeft, ChevronRight, LogOut,
} from "lucide-react";
import GhostLogo from "../../../components/GhostLogo";

const NAV_ITEMS = [
  { id: "overview",  label: "סקירה כללית",  icon: LayoutDashboard },
  { id: "tenants",   label: "דיירים",        icon: Building2 },
  { id: "agents",    label: "סוכנים",        icon: Cpu },
  { id: "events",    label: "אירועים חיים",  icon: Radio },
  { id: "threats",   label: "מפת איומים",    icon: Map },
  { id: "activity",  label: "פעילות",        icon: Activity },
];

export default function SuperAdminSidebar({ activeTab, onTabChange }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`flex flex-col bg-[#0d0d14] border-r border-cyan-900/30 transition-all duration-300 ${
        collapsed ? "w-16" : "w-56"
      } min-h-screen`}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-cyan-900/30">
        <GhostLogo size={22} className="text-cyan-400 shrink-0" />
        {!collapsed && (
          <span className="text-cyan-300 font-bold text-sm tracking-widest whitespace-nowrap">
            GHOST
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-1 px-2">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                active
                  ? "bg-cyan-500/10 text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.25)]"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
              }`}
            >
              <Icon size={18} className={active ? "text-cyan-400" : ""} />
              {!collapsed && <span className="truncate">{label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="px-2 pb-4 flex flex-col gap-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center p-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-colors"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-colors text-sm">
          <LogOut size={16} />
          {!collapsed && <span>יציאה</span>}
        </button>
      </div>
    </aside>
  );
}
