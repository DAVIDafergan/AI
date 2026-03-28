"use client";

// הגדרות מדיניות עם מתג מותאם
// קומפוננט מתג בנוי עם Tailwind בלבד (ללא ספרייה חיצונית)
function ToggleSwitch({ enabled, onToggle }) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={enabled}
      className={`relative inline-flex items-center w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-emerald-500 ${
        enabled ? "bg-emerald-500" : "bg-slate-600"
      }`}
    >
      {/* הנקודה המתנועעת */}
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
    PII: "מידע אישי מזהה (PII)",
    KEYWORDS: "מילות מפתח",
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
  if (!policies || policies.length === 0) return null;

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
                  {/* כותרת מדיניות */}
                  <p className="text-white font-medium text-sm">{policy.label}</p>
                  {/* תיאור */}
                  <p className="text-slate-400 text-xs mt-0.5 truncate">{policy.description}</p>
                </div>
                {/* מתג */}
                <ToggleSwitch
                  enabled={policy.enabled}
                  onToggle={() => onToggle && onToggle(policy.id)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
