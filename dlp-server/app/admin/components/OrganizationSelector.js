"use client";

// בחירת ארגון במערכת Multi-tenant – עם תמיכה בכל הארגונים וכפתור הוספה
import { useState, useEffect, useCallback } from "react";
import { Building2, ChevronDown, Plus, Check } from "lucide-react";
import ClientOnboardingWizard from "./ClientOnboardingWizard";

export default function OrganizationSelector({ currentOrgId = "default-org", onOrgChange }) {
  const [allOrgs, setAllOrgs]   = useState([]);
  const [selectedId, setSelectedId] = useState(currentOrgId);
  const [open, setOpen]         = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  // שם הארגון הנבחר
  const selectedOrg = allOrgs.find((o) => o.id === selectedId) || null;

  const fetchOrgs = useCallback(async () => {
    try {
      const res = await fetch("/api/clients");
      if (!res.ok) return;
      const data = await res.json();
      setAllOrgs(data.clients || []);
    } catch {
      // שגיאת רשת – המשך ללא נתונים
    }
  }, []);

  useEffect(() => { fetchOrgs(); }, [fetchOrgs]);

  function handleSelect(orgId) {
    setSelectedId(orgId);
    setOpen(false);
    if (onOrgChange) onOrgChange(orgId);
  }

  return (
    <>
      <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">ארגון פעיל</h3>

        <div className="flex items-center gap-2">
          {/* Dropdown בחירת ארגון */}
          <div className="relative flex-1">
            <button
              onClick={() => setOpen((o) => !o)}
              className="w-full flex items-center justify-between gap-2 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white hover:bg-slate-700 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="truncate">{selectedOrg?.name || "ארגון ברירת מחדל"}</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
              <div className="absolute top-full right-0 mt-2 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                <div className="p-2 max-h-64 overflow-y-auto">
                  {allOrgs.length === 0 ? (
                    <p className="text-sm text-slate-400 px-3 py-2">אין ארגונים</p>
                  ) : (
                    allOrgs.map((org) => (
                      <button
                        key={org.id}
                        onClick={() => handleSelect(org.id)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm rounded-lg hover:bg-slate-700 transition-colors text-right"
                      >
                        <div className="flex flex-col items-start">
                          <span className="text-white font-medium">{org.name}</span>
                          <span className="text-xs text-slate-400 font-mono">{org.id.slice(0, 14)}…</span>
                        </div>
                        {org.id === selectedId && <Check className="w-4 h-4 text-blue-400 shrink-0" />}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* כפתור + הוספת ארגון חדש */}
          <button
            onClick={() => { setOpen(false); setShowWizard(true); }}
            title="הוסף ארגון חדש"
            className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* פרטי ארגון נבחר */}
        {selectedOrg && (
          <div className="mt-4 pt-4 border-t border-slate-700/50 space-y-1 text-sm">
            <div className="flex justify-between text-slate-400">
              <span>מזהה:</span>
              <code className="text-slate-300 font-mono text-xs">{selectedOrg.id}</code>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>חבילה:</span>
              <span className="text-slate-300">
                {selectedOrg.plan === "enterprise" ? "Enterprise" : selectedOrg.plan === "pro" ? "מקצועי" : "בסיסי"}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>נוצר:</span>
              <span className="text-slate-300">{new Date(selectedOrg.createdAt).toLocaleDateString("he-IL")}</span>
            </div>
            {selectedOrg.contactEmail && (
              <div className="flex justify-between text-slate-400">
                <span>איש קשר:</span>
                <span className="text-slate-300">{selectedOrg.contactEmail}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-400">
              <span>סטטוס:</span>
              <span className={`${
                selectedOrg.status === "active" ? "text-green-400" :
                selectedOrg.status === "trial"  ? "text-yellow-400" : "text-red-400"
              }`}>
                {selectedOrg.status === "active" ? "פעיל" : selectedOrg.status === "trial" ? "ניסיון" : "מושהה"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* אשף הוספת ארגון */}
      {showWizard && (
        <ClientOnboardingWizard
          onClose={() => setShowWizard(false)}
          onClientCreated={() => { fetchOrgs(); setShowWizard(false); }}
        />
      )}
    </>
  );
}
