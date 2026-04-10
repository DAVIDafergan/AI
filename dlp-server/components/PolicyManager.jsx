"use client";

/**
 * PolicyManager.jsx
 *
 * Full-featured DLP policy management component.
 * Fetches the tenant's live policy from the server, renders toggle switches for
 * each PII category, and persists changes to MongoDB via PUT /api/organizations/policy.
 *
 * Props:
 *   apiKey  {string}  – tenant API key (passed as x-api-key header)
 *   apiBase {string}  – base URL of the DLP server (default: "")
 */

import { useState, useEffect, useCallback } from "react";
import { Shield, RefreshCw, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

// ── Severity badge ──────────────────────────────────────────────────────────
const SEVERITY_STYLES = {
  critical: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  high:     "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium:   "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low:      "bg-blue-500/20 text-blue-400 border-blue-500/30",
};
const SEVERITY_LABELS = { critical: "קריטי", high: "גבוה", medium: "בינוני", low: "נמוך" };

const CATEGORY_LABELS = {
  PII:      "מידע אישי מזהה (PII)",
  KEYWORDS: "מילות מפתח",
  SECRETS:  "סודות ומפתחות",
  NETWORK:  "רשת ותשתית",
  CUSTOM:   "מותאם אישית",
};

// ── Toggle switch ───────────────────────────────────────────────────────────
function ToggleSwitch({ enabled, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex items-center w-12 h-6 rounded-full transition-colors duration-200
        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-cyan-500
        disabled:opacity-50 disabled:cursor-not-allowed
        ${enabled ? "bg-cyan-500" : "bg-slate-600"}`}
    >
      <span
        className={`inline-block w-5 h-5 bg-white rounded-full shadow-md transform transition-transform duration-200 ${
          enabled ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

// ── Skeleton loader ─────────────────────────────────────────────────────────
function PolicySkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="flex items-center justify-between p-4 bg-slate-800/40 border border-slate-700/30 rounded-xl">
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-slate-700/60 rounded w-40" />
            <div className="h-2.5 bg-slate-700/40 rounded w-64" />
          </div>
          <div className="w-12 h-6 bg-slate-700/60 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export default function PolicyManager({ apiKey, apiBase = "" }) {
  const [policies, setPolicies]     = useState(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [pendingId, setPendingId]   = useState(null);

  // Fetch policies from server
  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/organizations/policy`, {
        headers: { "x-api-key": apiKey },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPolicies(data.policies || []);
    } catch (err) {
      setError(`שגיאה בטעינת המדיניות: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [apiKey, apiBase]);

  useEffect(() => {
    if (apiKey) fetchPolicies();
  }, [apiKey, fetchPolicies]);

  // Toggle a single policy and persist immediately
  async function handleToggle(policyId) {
    if (saving || pendingId) return;
    setPendingId(policyId);
    setSaving(true);
    setSuccessMsg(null);
    setError(null);

    const previousPolicies = policies;
    const updated = policies.map((p) =>
      p.id === policyId ? { ...p, enabled: !p.enabled } : p
    );
    setPolicies(updated); // optimistic update

    try {
      const res = await fetch(`${apiBase}/api/organizations/policy`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ policies: updated }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setPolicies(data.policies);
      setSuccessMsg("המדיניות עודכנה בהצלחה");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      // Revert optimistic update on failure
      setPolicies(previousPolicies);
      setError(`שגיאה בשמירת המדיניות: ${err.message}`);
    } finally {
      setSaving(false);
      setPendingId(null);
    }
  }

  if (!apiKey) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm p-4">
        <AlertTriangle size={16} />
        <span>נדרש מפתח API להצגת המדיניות</span>
      </div>
    );
  }

  // Group policies by category
  const grouped = policies
    ? policies.reduce((acc, p) => {
        const cat = p.category || "CUSTOM";
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(p);
        return acc;
      }, {})
    : {};

  return (
    <div className="bg-[#0d0d14] border border-slate-700/40 rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="text-cyan-400" size={18} />
          <h3 className="text-sm font-semibold text-slate-200">מנהל מדיניות DLP</h3>
        </div>
        <button
          onClick={fetchPolicies}
          disabled={loading}
          title="רענן מדיניות"
          className="p-1.5 rounded-lg text-slate-500 hover:text-cyan-300 hover:bg-slate-800 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Status bar */}
      {successMsg && (
        <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
          <CheckCircle size={13} />
          {successMsg}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <XCircle size={13} />
          {error}
        </div>
      )}

      {/* Policy list */}
      {loading ? (
        <PolicySkeleton />
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              {/* Category header */}
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {CATEGORY_LABELS[category] || category}
                </span>
                <div className="flex-1 h-px bg-slate-700/40" />
              </div>

              {/* Policy rows */}
              <div className="space-y-2">
                {items.map((policy) => (
                  <div
                    key={policy.id}
                    className={`flex items-center justify-between p-3.5 border rounded-xl transition-colors ${
                      policy.enabled
                        ? "bg-slate-800/60 border-slate-700/40"
                        : "bg-slate-900/40 border-slate-800/30 opacity-70"
                    }`}
                  >
                    <div className="flex-1 min-w-0 mr-4">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-slate-200">{policy.label}</span>
                        {policy.severity && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold border ${
                            SEVERITY_STYLES[policy.severity] || SEVERITY_STYLES.medium
                          }`}>
                            {SEVERITY_LABELS[policy.severity] || policy.severity}
                          </span>
                        )}
                      </div>
                      {policy.description && (
                        <p className="text-xs text-slate-500 truncate">{policy.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {pendingId === policy.id && (
                        <RefreshCw size={12} className="text-cyan-400 animate-spin" />
                      )}
                      <ToggleSwitch
                        enabled={policy.enabled}
                        disabled={saving}
                        onChange={() => handleToggle(policy.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {policies.length === 0 && (
            <p className="text-xs text-slate-600 text-center py-4">אין מדיניות להצגה</p>
          )}
        </div>
      )}
    </div>
  );
}
