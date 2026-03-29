// lib/db.js – In-memory data store (TODO: replace with MongoDB/Firestore in production)

// ── Stores ──────────────────────────────────────────────────────────────────
const mappingsStore = new Map(); // key = synthetic value → { synthetic, original, category, label, timestamp, source }
const logsStore = [];            // array of log objects
const customRulesStore = new Map(); // key = id → { id, word, category, replacement, createdAt }
const policiesStore = new Map(); // key = id → { id, enabled }
const alertsStore = [];          // array of alert objects
const patternStatsStore = new Map(); // key = category → { category, count, lastSeen }
const requestTimestamps = [];    // timestamps for anomaly detection

let logIdCounter = 1;
let alertIdCounter = 1;

// ── Default Policies ─────────────────────────────────────────────────────────
const DEFAULT_POLICIES = [
  { id: "credit_card",   label: "חסימת כרטיסי אשראי",    description: "זיהוי וחסימה של מספרי כרטיסי אשראי",               enabled: true,  category: "PII" },
  { id: "israeli_id",    label: "חסימת תעודות זהות",      description: "זיהוי מספרי ת.ז. ישראליים (9 ספרות)",              enabled: true,  category: "PII" },
  { id: "email",         label: "חסימת כתובות אימייל",    description: "זיהוי וחסימה של כתובות דואר אלקטרוני",             enabled: true,  category: "PII" },
  { id: "phone",         label: "חסימת מספרי טלפון",      description: "זיהוי מספרי טלפון נייד ונייח ישראליים",           enabled: true,  category: "PII" },
  { id: "keywords",      label: "חסימת מילות מפתח",       description: "זיהוי ביטויים רגישים כמו 'פרויקט סודי'",           enabled: true,  category: "KEYWORDS" },
  { id: "iban",          label: "חסימת מספרי IBAN",       description: "זיהוי מספרי חשבון בנק בינלאומיים",                 enabled: true,  category: "PII" },
  { id: "ip_address",    label: "חסימת כתובות IP",         description: "זיהוי כתובות IPv4",                                enabled: true,  category: "PII" },
  { id: "passport",      label: "חסימת מספרי דרכון",      description: "זיהוי מספרי דרכון ישראליים",                       enabled: true,  category: "PII" },
  { id: "vehicle",       label: "חסימת מספרי רכב",        description: "זיהוי מספרי לוחית רישוי ישראליים",                enabled: false, category: "PII" },
  { id: "birthdate",     label: "חסימת תאריך לידה",       description: "זיהוי תאריכים בפורמט DD/MM/YYYY",                  enabled: true,  category: "PII" },
  { id: "context",       label: "זיהוי מהקשר",             description: "זיהוי כתובות, שמות וסיסמאות מהקשר טקסטואלי",      enabled: true,  category: "CONTEXT" },
  { id: "custom",        label: "כללים מותאמים",           description: "כללים שהוגדרו ע\"י מנהל המערכת",                   enabled: true,  category: "CUSTOM" },
];

// ── Mappings ─────────────────────────────────────────────────────────────────
export function saveMappings(entries) {
  for (const entry of entries) {
    mappingsStore.set(entry.synthetic, entry);
  }
}

export function getMappingBySynthetic(synthetic) {
  return mappingsStore.get(synthetic) || null;
}

export function getAllMappings() {
  return Array.from(mappingsStore.values());
}

// ── Logs ──────────────────────────────────────────────────────────────────────
export function saveLog(logEntry) {
  const log = { id: logIdCounter++, ...logEntry, timestamp: logEntry.timestamp || new Date().toISOString() };
  logsStore.unshift(log); // newest first
  if (logsStore.length > 1000) logsStore.splice(1000); // cap at 1000
  return log;
}

export function getLogs({ limit = 50, category, search } = {}) {
  let result = [...logsStore];
  if (category) result = result.filter(l => l.category === category || l.type === category);
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(l =>
      (l.type || "").toLowerCase().includes(q) ||
      (l.synthetic || "").toLowerCase().includes(q) ||
      (l.source || "").toLowerCase().includes(q)
    );
  }
  return result.slice(0, limit);
}

// ── Stats ─────────────────────────────────────────────────────────────────────
export function getStats() {
  const totalBlocked = logsStore.length;

  // topEntity
  const catCount = {};
  for (const log of logsStore) {
    const key = log.type || log.category || "אחר";
    catCount[key] = (catCount[key] || 0) + 1;
  }
  const topEntity = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

  // privacyScore (simple heuristic: 100 - capped by high-risk events)
  const highRisk = logsStore.filter(l => l.threatScore && l.threatScore > 70).length;
  const privacyScore = totalBlocked === 0 ? 100 : Math.max(50, Math.round(100 - (highRisk / Math.max(1, totalBlocked)) * 50));

  // avgThreatScore
  const scored = logsStore.filter(l => l.threatScore != null);
  const avgThreatScore = scored.length
    ? Math.round(scored.reduce((s, l) => s + l.threatScore, 0) / scored.length)
    : 0;

  // dailyBlocks – last 7 days
  const dayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const today = new Date();
  const dailyBlocks = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dayLabel = dayNames[d.getDay()];
    const dateStr = d.toISOString().slice(0, 10);
    const blocks = logsStore.filter(l => l.timestamp && l.timestamp.startsWith(dateStr)).length;
    dailyBlocks.push({ day: dayLabel, date: dateStr, blocks });
  }

  // categoryBreakdown
  const CATEGORY_COLORS = {
    "כרטיס אשראי": "#f43f5e",
    "תעודת זהות": "#8b5cf6",
    "אימייל": "#3b82f6",
    "טלפון נייד": "#22c55e",
    "טלפון נייח": "#10b981",
    "מילות מפתח": "#f59e0b",
    "IBAN": "#06b6d4",
    "כתובת IP": "#ec4899",
    "דרכון": "#a78bfa",
    "מספר רכב": "#fb923c",
    "תאריך לידה": "#84cc16",
    "כתובת": "#e879f9",
    "שם מלא": "#38bdf8",
    "סיסמה": "#ef4444",
    "חשבון בנק": "#fbbf24",
    "כלל מותאם": "#94a3b8",
  };
  const categoryBreakdown = Object.entries(catCount)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value, color: CATEGORY_COLORS[name] || "#94a3b8" }));

  // recentLogs
  const recentLogs = logsStore.slice(0, 20).map(l => ({
    id: l.id,
    timestamp: l.timestamp,
    type: l.type || l.category,
    synthetic: l.synthetic,
    placeholder: l.synthetic,
    source: l.source || "api",
    status: "blocked",
    threatScore: l.threatScore,
    category: l.category,
  }));

  // policySettings
  const policySettings = getPolicies();

  return {
    kpi: { totalBlocked, privacyScore, topEntity, activeUsers: 1, avgThreatScore },
    dailyBlocks,
    categoryBreakdown,
    recentLogs,
    policySettings,
  };
}

// ── Custom Rules ──────────────────────────────────────────────────────────────
let ruleIdCounter = 1;

export function saveCustomRule({ word, category = "CUSTOM", replacement }) {
  const id = `rule_${ruleIdCounter++}_${Date.now()}`;
  const rule = { id, word, category, replacement, createdAt: new Date().toISOString() };
  customRulesStore.set(id, rule);
  return rule;
}

export function getCustomRules() {
  return Array.from(customRulesStore.values());
}

export function deleteCustomRule(id) {
  return customRulesStore.delete(id);
}

// ── Policies ─────────────────────────────────────────────────────────────────
export function getPolicies() {
  return DEFAULT_POLICIES.map(p => {
    const override = policiesStore.get(p.id);
    return override != null ? { ...p, enabled: override.enabled } : p;
  });
}

export function updatePolicy(id, enabled) {
  policiesStore.set(id, { id, enabled });
  return getPolicies().find(p => p.id === id);
}

export function isPolicyEnabled(id) {
  const override = policiesStore.get(id);
  if (override != null) return override.enabled;
  const def = DEFAULT_POLICIES.find(p => p.id === id);
  return def ? def.enabled : true;
}

// ── Alerts ────────────────────────────────────────────────────────────────────
export function saveAlert(alert) {
  const a = { id: alertIdCounter++, ...alert, timestamp: new Date().toISOString(), read: false };
  alertsStore.unshift(a);
  if (alertsStore.length > 200) alertsStore.splice(200);
  return a;
}

export function getAlerts({ unreadOnly = false } = {}) {
  return unreadOnly ? alertsStore.filter(a => !a.read) : [...alertsStore];
}

export function markAlertRead(id) {
  const a = alertsStore.find(a => a.id === id);
  if (a) { a.read = true; return a; }
  return null;
}

// ── Anomaly Detection ─────────────────────────────────────────────────────────
export function recordRequest() {
  const now = Date.now();
  requestTimestamps.push(now);
  // keep only last 5 minutes
  const cutoff = now - 5 * 60 * 1000;
  while (requestTimestamps.length && requestTimestamps[0] < cutoff) requestTimestamps.shift();

  // spike: more than 30 requests in the last minute
  const oneMinAgo = now - 60 * 1000;
  const recentCount = requestTimestamps.filter(t => t >= oneMinAgo).length;
  if (recentCount >= 30) {
    // check if we already have an unread alert for this spike
    const existing = alertsStore.find(a => a.type === "SPIKE" && !a.read);
    if (!existing) {
      saveAlert({ type: "SPIKE", message: `זוהה עומס חריג: ${recentCount} בקשות בדקה האחרונה`, severity: "high" });
    }
  }
}

// ── Pattern Stats ─────────────────────────────────────────────────────────────
export function recordPatternHit(category) {
  const entry = patternStatsStore.get(category) || { category, count: 0, lastSeen: null };
  entry.count++;
  entry.lastSeen = new Date().toISOString();
  patternStatsStore.set(category, entry);
}

export function getPatternStats() {
  return Array.from(patternStatsStore.values()).sort((a, b) => b.count - a.count);
}
