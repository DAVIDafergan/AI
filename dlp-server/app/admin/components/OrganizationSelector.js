"use client";

// בחירת ארגון במערכת Multi-tenant
import { useState, useEffect } from "react";
import { Building2, ChevronDown } from "lucide-react";

export default function OrganizationSelector({ currentOrgId = "default-org" }) {
  const [orgInfo, setOrgInfo] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    async function fetchOrg() {
      try {
        const res = await fetch("/api/organizations");
        if (!res.ok) return;
        const data = await res.json();
        setOrgInfo(data.organization);
      } catch {
        // שגיאת רשת – המשך ללא נתונים
      }
    }
    fetchOrg();
  }, [currentOrgId]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white hover:bg-slate-700 transition-colors"
      >
        <Building2 className="w-4 h-4 text-slate-400" />
        <span>{orgInfo?.name || "ארגון ברירת מחדל"}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 p-4">
          <div className="text-xs text-slate-400 mb-2 font-semibold uppercase tracking-wider">
            פרטי ארגון
          </div>
          {orgInfo ? (
            <div className="space-y-2">
              <div className="text-sm text-white font-medium">{orgInfo.name}</div>
              <div className="text-xs text-slate-400">מזהה: {orgInfo.id}</div>
              <div className="text-xs text-slate-400">
                נוצר: {new Date(orgInfo.createdAt).toLocaleDateString("he-IL")}
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-400">טוען...</div>
          )}
          <div className="mt-3 pt-3 border-t border-slate-700 text-xs text-slate-500">
            Multi-tenancy: Enterprise
          </div>
        </div>
      )}
    </div>
  );
}
