"use client";

// הגדרות מדיניות עם מתג, תג חומרה וחיבור ל-API
import { useState } from "react";

const SEVERITY_STYLES = {
  critical: "bg-rose-500/20 text-rose-400",
  high:     "bg-orange-500/20 text-orange-400",
  medium:   "bg-yellow-500/20 text-yellow-400",
  low:      "bg-blue-500/20 text-blue-400",
};

const SEVERITY_LABELS = {
  critical: "קריטי",
  high:     "גבוה",
  medium:   "בינוני",
  low:      "נמוך",
};

// מתג מותאם
function ToggleSwitch({ enabled, onToggle, loading }) {
  return (
    <button
      onClick={onToggle}
      disabled={loading}
      role="switch"
      aria-checked={enabled}
      className={`relative inline-flex items-center w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-emerald-500 disabled:opacity-60 ${
        enabled ? "bg-emerald-500" : "bg-slate-600"
      }`}
    >
      <span
        className={`inline-block w-5 h-5 bg-white rounded-full shadow-md transform transition-transform duration-200 ${
          enabled ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

// כותרת קטגוריה
function CategoryHeader({ category }) {
  const labels = {
    PII:      "מידע אישי מזהה (PII)",
    KEYWORDS: "מילות מפתח",
    SECRETS:  "סודות ומפתחות",
    NETWORK:  "רשת ותשתית",
    CUSTOM:   "מותאם אישית",
  };
  return (
    <div className="flex items-center gap-3 mb-3 mt-6 first:mt-0">
      <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">
        {labels[category] || category}
      </span>
      <div className="flex-1 h-px bg-slate-700/50" />
    </div>
  );
}

export default function PolicySettings({ policies, onToggle }) {
  const [loadingId, setLoadingId] = useState(null);

  if (!policies || policies.length === 0) return null;

  async function handleToggle(id) {
    setLoadingId(id);
    await onToggle(id);
    setLoadingId(null);
  }

  // קיבוץ לפי קטגוריה
  const grouped = policies.reduce((acc, policy) => {
    if (!acc[policy.category]) acc[policy.category] = [];
    acc[policy.category].push(policy);
    return acc;
  }, {});

  return (
    <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-6 shadow-lg">
      <h3 className="text-white font-semibold text-lg mb-4">הגדרות מדיניות</h3>
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category}>
          <CategoryHeader category={category} />
          <div className="space-y-3">
            {items.map((policy) => (
              <div
                key={policy.id}
                className="flex items-center justify-between p-4 bg-slate-800/50 border border-slate-700/30 rounded-xl hover:bg-slate-800 transition-colors"
              >
                <div className="flex-1 min-w-0 ml-4">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-white font-medium text-sm">{policy.label}</p>
                    {/* תג חומרה */}
                    {policy.severity && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        SEVERITY_STYLES[policy.severity] || SEVERITY_STYLES.medium
                      }`}>
                        {SEVERITY_LABELS[policy.severity] || policy.severity}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-400 text-xs truncate">{policy.description}</p>
                </div>
                <ToggleSwitch
                  enabled={policy.enabled}
                  loading={loadingId === policy.id}
                  onToggle={() => handleToggle(policy.id)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
