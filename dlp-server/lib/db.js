// מסד נתונים בזיכרון – In-Memory Store עם תמיכה ב-Multi-tenancy
// TODO: להעביר ל-MongoDB/Redis בסביבת Production

import { randomUUID } from "crypto";

// ── מאגרי נתונים ──
const organizations = new Map(); // organizationId → orgData
const mappings = new Map();      // mappingId → { tag, originalText, organizationId, ... }
const logs = new Map();          // logId → logEntry
const policies = new Map();      // organizationId → [ policy, ... ]
const customKeywords = new Map();// organizationId → [ keyword, ... ]
const alerts = new Map();        // alertId → alertData
const apiKeys = new Map();       // apiKey → organizationId

// ── ברירת מחדל: ארגון "default-org" ──
function seed() {
  const defaultOrgId = "default-org";
  organizations.set(defaultOrgId, {
    id: defaultOrgId,
    name: "ארגון ברירת מחדל",
    createdAt: new Date().toISOString(),
    settings: { language: "he", timezone: "Asia/Jerusalem" },
  });
  apiKeys.set("dev-api-key-12345", defaultOrgId);
  apiKeys.set("test-api-key-99999", defaultOrgId);
}
seed();

// ── ניהול ארגונים ──
export function createOrganization({ name, id } = {}) {
  const orgId = id || randomUUID();
  const org = {
    id: orgId,
    name: name || "ארגון חדש",
    createdAt: new Date().toISOString(),
    settings: { language: "he", timezone: "Asia/Jerusalem" },
  };
  organizations.set(orgId, org);
  const newApiKey = `key-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  apiKeys.set(newApiKey, orgId);
  return { ...org, apiKey: newApiKey };
}

export function getOrganization(orgId) {
  return organizations.get(orgId) || null;
}

export function getAllOrganizations() {
  return [...organizations.values()];
}

export function updateOrganization(orgId, updates) {
  const existing = organizations.get(orgId);
  if (!existing) return null;
  const updated = { ...existing, ...updates, id: orgId };
  organizations.set(orgId, updated);
  return updated;
}

// ── ניהול API Keys ──
export function validateApiKey(key) {
  const orgId = apiKeys.get(key);
  if (!orgId) return null;
  const org = organizations.get(orgId);
  return org ? { organizationId: orgId, orgName: org.name } : null;
}

export function createApiKey(orgId) {
  const key = `key-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  apiKeys.set(key, orgId);
  return key;
}

// ── שמירת מיפוי (synthetic → original) ──
export function saveMappings(organizationId, entries) {
  // entries: [{ tag, originalText, category, label, source }]
  const saved = [];
  for (const entry of entries) {
    const id = randomUUID();
    const doc = {
      id,
      organizationId,
      tag: entry.tag,
      originalText: entry.originalText,
      category: entry.category,
      label: entry.label || "",
      source: entry.source || "",
      createdAt: new Date().toISOString(),
    };
    mappings.set(id, doc);
    saved.push(doc);
  }
  return saved;
}

export function getMappings(organizationId, limit = 100) {
  const result = [];
  for (const doc of mappings.values()) {
    if (doc.organizationId === organizationId) result.push(doc);
  }
  return result
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

export function getMappingByTag(tag) {
  for (const doc of mappings.values()) {
    if (doc.tag === tag) return doc;
  }
  return null;
}

// ── שמירת לוג ──
export function saveLog(organizationId, entry) {
  const id = randomUUID();
  const doc = {
    id,
    organizationId,
    timestamp: new Date().toISOString(),
    type: entry.type || "UNKNOWN",
    synthetic: entry.synthetic || "",
    originalText: entry.originalText || "",
    source: entry.source || "unknown",
    status: entry.status || "blocked",
    threatScore: entry.threatScore || 0,
    detectionCount: entry.detectionCount || 0,
    replacements: entry.replacements || [],
  };
  logs.set(id, doc);
  return doc;
}

export function getLogs(organizationId, limit = 50) {
  const result = [];
  for (const doc of logs.values()) {
    if (doc.organizationId === organizationId) result.push(doc);
  }
  return result
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
}

// ── סטטיסטיקות דינמיות ──
export function getStats(organizationId) {
  const orgLogs = [];
  const orgMappings = [];

  for (const doc of logs.values()) {
    if (doc.organizationId === organizationId) orgLogs.push(doc);
  }
  for (const doc of mappings.values()) {
    if (doc.organizationId === organizationId) orgMappings.push(doc);
  }

  const totalBlocked = orgLogs.length;
  const avgThreatScore =
    totalBlocked > 0
      ? Math.round(orgLogs.reduce((s, l) => s + (l.threatScore || 0), 0) / totalBlocked)
      : 0;
  const privacyScore = Math.max(0, Math.min(100, 100 - avgThreatScore * 0.5));

  // קטגוריה מובילה
  const catCount = {};
  for (const m of orgMappings) {
    catCount[m.label || m.category] = (catCount[m.label || m.category] || 0) + 1;
  }
  const topEntity =
    Object.keys(catCount).length > 0
      ? Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a])[0]
      : "אין נתונים";

  // חסימות לפי יום בשבוע (7 ימים אחרונים)
  const dayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const dailyBlocks = dayNames.map((day) => ({ day, blocks: 0 }));
  const now = new Date();
  for (const log of orgLogs) {
    const d = new Date(log.timestamp);
    const diff = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diff < 7) {
      const dayIdx = d.getDay(); // 0=ראשון
      dailyBlocks[dayIdx].blocks++;
    }
  }

  // פירוט לפי קטגוריה
  const COLORS = {
    "כרטיס אשראי": "#f43f5e",
    "תעודת זהות": "#8b5cf6",
    "אימייל": "#3b82f6",
    "טלפון נייד": "#22c55e",
    "טלפון נייח": "#06b6d4",
    "IBAN": "#f97316",
    "כתובת IP": "#a855f7",
    "דרכון": "#ec4899",
    "מלוחית": "#14b8a6",
    "תאריך לידה": "#84cc16",
    "מפתח AWS": "#ef4444",
    "מפתח OpenAI": "#10b981",
    "מפתח API": "#6366f1",
    "כתובת": "#0ea5e9",
    "שם מלא": "#d946ef",
    "סיסמה": "#dc2626",
    "חשבון בנק": "#b45309",
    "מילות מפתח": "#f59e0b",
  };
  const catBreakdown = {};
  for (const m of orgMappings) {
    const key = m.label || m.category;
    catBreakdown[key] = (catBreakdown[key] || 0) + 1;
  }
  const categoryBreakdown = Object.entries(catBreakdown).map(([name, value]) => ({
    name,
    value,
    color: COLORS[name] || "#94a3b8",
  }));

  return {
    kpi: {
      totalBlocked,
      privacyScore: parseFloat(privacyScore.toFixed(1)),
      topEntity,
      activeUsers: Math.max(1, Math.floor(totalBlocked / 5)),
      avgThreatScore,
    },
    dailyBlocks,
    categoryBreakdown,
  };
}

// ── ניהול מדיניות ──
export function savePolicies(organizationId, policiesArray) {
  policies.set(organizationId, policiesArray);
  return policiesArray;
}

export function getPolicies(organizationId) {
  return policies.get(organizationId) || null;
}

// ── מילות מפתח מותאמות ──
export function saveCustomKeyword(organizationId, entry) {
  const id = randomUUID();
  const keywords = customKeywords.get(organizationId) || [];
  const doc = {
    id,
    organizationId,
    word: entry.word,
    category: entry.category || "CUSTOM",
    replacement: entry.replacement || "",
    severity: entry.severity || "medium",
    createdAt: new Date().toISOString(),
  };
  keywords.push(doc);
  customKeywords.set(organizationId, keywords);
  return doc;
}

export function getCustomKeywords(organizationId) {
  return customKeywords.get(organizationId) || [];
}

export function deleteCustomKeyword(organizationId, keywordId) {
  const keywords = customKeywords.get(organizationId) || [];
  const filtered = keywords.filter((k) => k.id !== keywordId);
  customKeywords.set(organizationId, filtered);
  return filtered;
}

// ── ניהול התראות ──
export function saveAlert(organizationId, entry) {
  const id = randomUUID();
  const doc = {
    id,
    organizationId,
    type: entry.type || "ANOMALY",
    message: entry.message || "",
    severity: entry.severity || "medium",
    read: false,
    createdAt: new Date().toISOString(),
  };
  alerts.set(id, doc);
  return doc;
}

export function getAlerts(organizationId) {
  const result = [];
  for (const doc of alerts.values()) {
    if (doc.organizationId === organizationId) result.push(doc);
  }
  return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function markAlertRead(alertId) {
  const alert = alerts.get(alertId);
  if (!alert) return null;
  const updated = { ...alert, read: true };
  alerts.set(alertId, updated);
  return updated;
}

// ── נתוני מגמה (30 ימים) ──
export function getTrendData(organizationId) {
  const orgLogs = [];
  for (const doc of logs.values()) {
    if (doc.organizationId === organizationId) orgLogs.push(doc);
  }

  const today = new Date();
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    days.push({ date: dateStr, blocks: 0, threatScore: 0, count: 0 });
  }

  for (const log of orgLogs) {
    const dateStr = log.timestamp.slice(0, 10);
    const entry = days.find((d) => d.date === dateStr);
    if (entry) {
      entry.blocks++;
      entry.threatScore += log.threatScore || 0;
      entry.count++;
    }
  }

  return days.map((d) => ({
    ...d,
    avgThreatScore: d.count > 0 ? Math.round(d.threatScore / d.count) : 0,
  }));
}

// ── ייצוא דוח כולל ──
export function generateReport(organizationId) {
  const org = getOrganization(organizationId);
  const stats = getStats(organizationId);
  const orgLogs = getLogs(organizationId, 1000);
  const orgPolicies = getPolicies(organizationId) || [];
  const orgKeywords = getCustomKeywords(organizationId);
  const trendData = getTrendData(organizationId);

  return {
    generatedAt: new Date().toISOString(),
    organization: org,
    summary: stats.kpi,
    dailyBlocks: stats.dailyBlocks,
    categoryBreakdown: stats.categoryBreakdown,
    trendData,
    policies: orgPolicies,
    customKeywords: orgKeywords,
    recentEvents: orgLogs.slice(0, 100),
    recommendations: generateRecommendations(stats),
  };
}

function generateRecommendations(stats) {
  const recs = [];
  if (stats.kpi.avgThreatScore > 70) {
    recs.push({ priority: "critical", text: "ציון איום ממוצע גבוה – מומלץ לבדוק מדיניות חסימה" });
  }
  if (stats.kpi.totalBlocked > 100) {
    recs.push({ priority: "high", text: "נפח חסימות גבוה – שקול להוסיף הדרכת עובדים" });
  }
  recs.push({ priority: "medium", text: "הפעל Two-Factor Authentication למשתמשי ניהול" });
  recs.push({ priority: "low", text: "בצע גיבוי ידני של המיפויים מדי שבוע" });
  return recs;
}

// ── Rate tracking for anomaly detection ──
const requestCounts = new Map(); // organizationId → [timestamps]

export function trackRequest(organizationId) {
  const now = Date.now();
  const times = (requestCounts.get(organizationId) || []).filter(
    (t) => now - t < 60000 // שמור רק את הדקה האחרונה
  );
  times.push(now);
  requestCounts.set(organizationId, times);
  return times.length;
}

// ── compat alias: getMappingBySynthetic (used by restore-batch route) ──
export function getMappingBySynthetic(syntheticValue) {
  const doc = getMappingByTag(syntheticValue);
  if (!doc) return null;
  // normalize to the shape expected by restore-batch
  return {
    synthetic: doc.tag,
    original: doc.originalText,
    category: doc.category,
    label: doc.label,
    timestamp: doc.createdAt,
    source: doc.source,
  };
}

// ── כללים מותאמים (Custom Rules) – compat with main's custom-rules route ──
const customRules = new Map(); // id → { id, word, category, replacement, createdAt }

export function getCustomRules() {
  return [...customRules.values()];
}

export function saveCustomRule({ word, category = "CUSTOM", replacement }) {
  const id = randomUUID();
  const rule = { id, word, category, replacement: replacement || word, createdAt: new Date().toISOString() };
  customRules.set(id, rule);
  return rule;
}

export function deleteCustomRule(id) {
  const rule = customRules.get(id);
  if (!rule) return null;
  customRules.delete(id);
  return rule;
}

// ── סטטיסטיקות תבניות (Pattern Stats) – compat with patterns-insights route ──
const patternStats = new Map(); // label → { label, count, lastSeen }

export function recordPatternHit(label) {
  const existing = patternStats.get(label) || { label, count: 0 };
  patternStats.set(label, {
    ...existing,
    count: existing.count + 1,
    lastSeen: new Date().toISOString(),
  });
}

export function getPatternStats() {
  return [...patternStats.values()].sort((a, b) => b.count - a.count);
}

// ── recordRequest – global rate tracking (compat with main) ──
export function recordRequest() {
  trackRequest("default-org");
}
