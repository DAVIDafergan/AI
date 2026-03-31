// מסד נתונים בזיכרון – In-Memory Store עם תמיכה ב-Multi-tenancy
// TODO: להעביר ל-MongoDB/Redis בסביבת Production

import { randomUUID } from "crypto";
import mongoose from "mongoose";

// ── MongoDB connection (used by new multi-tenant models) ──
let mongooseConnection = null;

// Disable buffering globally – operations will throw immediately if there is no
// active connection instead of silently queuing and timing out after 10 s.
mongoose.set("bufferCommands", false);

export async function connectMongo() {
  if (mongooseConnection && mongoose.connection.readyState === 1) {
    return mongooseConnection;
  }
  const uri = process.env.MONGODB_URI || "mongodb://mongo:CJIYYeWjRwoQChiJPyxBjQGbqbsfgQeu@ballast.proxy.rlwy.net:56402";
  try {
    mongooseConnection = await mongoose.connect(uri);
    return mongooseConnection;
  } catch (err) {
    console.error("[connectMongo] Failed to connect:", err.message);
    throw err;
  }
}

// ── Tenant Schema ──
const TenantSchema = new mongoose.Schema(
  {
    name:          { type: String, required: true, unique: true },
    slug:          { type: String, required: true, unique: true },
    apiKey:        { type: String, required: true, unique: true },
    apiSecret:     { type: String, required: true },
    status:        { type: String, enum: ["active", "suspended", "trial", "expired"], default: "trial" },
    plan:          { type: String, enum: ["starter", "professional", "enterprise"], default: "starter" },
    maxAgents:     { type: Number, default: 5 },
    maxUsersPerAgent: { type: Number, default: 50 },
    contactEmail:  { type: String, required: true },
    contactName:   { type: String },
    domain:        { type: String },
    settings: {
      autoBlockThreshold: { type: Number, default: 80 },
      retentionDays:      { type: Number, default: 30 },
      allowedCategories:  [String],
      webhookUrl:         { type: String },
      slackChannel:       { type: String },
    },
    usage: {
      totalScans:    { type: Number, default: 0 },
      totalBlocks:   { type: Number, default: 0 },
      lastActivity:  { type: Date },
      monthlyScans:  { type: Number, default: 0 },
      monthlyQuota:  { type: Number, default: 10000 },
    },
  },
  { timestamps: true }
);

// ── Agent Schema ──
const AgentSchema = new mongoose.Schema(
  {
    tenantId:    { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    name:        { type: String, required: true },
    agentKey:    { type: String, required: true, unique: true },
    syncStatus:  { type: String, enum: ["learning", "active", "offline", "error", "paused"], default: "learning" },
    lastPing:    { type: Date },
    lastPingIp:  { type: String },
    version:     { type: String, default: "1.0.0" },
    environment: { type: String, enum: ["production", "staging", "development"], default: "production" },
    metrics: {
      documentsIndexed: { type: Number, default: 0 },
      vectorsStored:    { type: Number, default: 0 },
      scansPerformed:   { type: Number, default: 0 },
      blocksExecuted:   { type: Number, default: 0 },
      avgResponseTime:  { type: Number, default: 0 },
      uptime:           { type: Number, default: 0 },
      lastScanAt:       { type: Date },
    },
    config: {
      scanInterval:           { type: Number, default: 500 },
      enableClipboard:        { type: Boolean, default: true },
      enableFileWatch:        { type: Boolean, default: false },
      enableNetworkInspection:{ type: Boolean, default: false },
      customPatterns:         [String],
    },
    deployedAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: false, updatedAt: "updatedAt" } }
);

// ── TenantEvent Schema (audit log) ──
const TenantEventSchema = new mongoose.Schema({
  tenantId:  { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
  agentId:   { type: mongoose.Schema.Types.ObjectId, ref: "Agent" },
  eventType: {
    type: String,
    enum: ["scan", "block", "alert", "agent_connect", "agent_disconnect", "config_change", "user_action"],
    required: true,
  },
  severity:  { type: String, enum: ["low", "medium", "high", "critical"], default: "low" },
  category:  { type: String },
  details:   { type: mongoose.Schema.Types.Mixed },
  userEmail: { type: String },
  ip:        { type: String },
  timestamp: { type: Date, default: Date.now },
});

TenantEventSchema.index({ tenantId: 1, timestamp: -1 });
TenantEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // TTL 90 days

export const Tenant = mongoose.models.Tenant || mongoose.model("Tenant", TenantSchema);
export const Agent  = mongoose.models.Agent  || mongoose.model("Agent",  AgentSchema);
export const TenantEvent = mongoose.models.TenantEvent || mongoose.model("TenantEvent", TenantEventSchema);

// ── מאגרי נתונים ──
const organizations = new Map(); // organizationId → orgData
const mappings = new Map();      // mappingId → { tag, originalText, organizationId, ... }
const logs = new Map();          // logId → logEntry
const policies = new Map();      // organizationId → [ policy, ... ]
const customKeywords = new Map();// organizationId → [ keyword, ... ]
const alerts = new Map();        // alertId → alertData
const apiKeys = new Map();       // apiKey → organizationId
const users = new Map();         // email → userStatsObject

// ── ברירת מחדל: ארגון "default-org" ──
function seed() {
  const defaultOrgId = "default-org";
  organizations.set(defaultOrgId, {
    id: defaultOrgId,
    name: "ארגון ברירת מחדל",
    createdAt: new Date().toISOString(),
    contactEmail: "",
    plan: "enterprise",
    notes: "",
    status: "active",
    settings: { language: "he", timezone: "Asia/Jerusalem" },
  });
  // הוסף מפתחות פיתוח רק בסביבת dev/test
  if (process.env.NODE_ENV !== "production") {
    apiKeys.set("dev-api-key-12345", defaultOrgId);
    apiKeys.set("test-api-key-99999", defaultOrgId);
  }
}
seed();

// ── ניהול ארגונים ──
export function createOrganization({ name, id, contactEmail = "", plan = "basic", notes = "", status = "active", initialPolicy = [] } = {}) {
  const orgId = id || randomUUID();
  const org = {
    id: orgId,
    name: name || "ארגון חדש",
    createdAt: new Date().toISOString(),
    contactEmail,
    plan,       // basic | pro | enterprise
    notes,
    status,     // active | suspended | trial
    settings: { language: "he", timezone: "Asia/Jerusalem" },
  };
  organizations.set(orgId, org);
  const newApiKey = `key-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  apiKeys.set(newApiKey, orgId);
  // שמירת מדיניות ראשונית אם סופקה
  if (initialPolicy && initialPolicy.length > 0) {
    policies.set(orgId, initialPolicy);
  }
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

// ── מחיקת ארגון + כל הנתונים הקשורים ──
export function deleteOrganization(orgId) {
  if (!organizations.has(orgId)) return false;
  organizations.delete(orgId);
  // מחיקת כל ה-API keys של הארגון
  for (const [key, oid] of apiKeys.entries()) {
    if (oid === orgId) apiKeys.delete(key);
  }
  // מחיקת logs
  for (const [id, doc] of logs.entries()) {
    if (doc.organizationId === orgId) logs.delete(id);
  }
  // מחיקת mappings
  for (const [id, doc] of mappings.entries()) {
    if (doc.organizationId === orgId) mappings.delete(id);
  }
  // מחיקת policies
  policies.delete(orgId);
  // מחיקת keywords
  customKeywords.delete(orgId);
  // מחיקת alerts
  for (const [id, doc] of alerts.entries()) {
    if (doc.organizationId === orgId) alerts.delete(id);
  }
  return true;
}

// ── סטטיסטיקות מהירות לארגון ──
export function getOrganizationStats(orgId) {
  let totalBlocked = 0;
  let lastBlockedAt = null;
  let totalThreat = 0;

  for (const doc of logs.values()) {
    if (doc.organizationId === orgId) {
      totalBlocked++;
      totalThreat += doc.threatScore || 0;
      if (!lastBlockedAt || doc.timestamp > lastBlockedAt) {
        lastBlockedAt = doc.timestamp;
      }
    }
  }

  const avgThreatScore = totalBlocked > 0 ? Math.round(totalThreat / totalBlocked) : 0;
  return { totalBlocked, lastBlockedAt, avgThreatScore };
}

// ── כל הארגונים עם סטטיסטיקות ──
export function getAllOrganizationsWithStats() {
  return [...organizations.values()].map((org) => ({
    ...org,
    stats: getOrganizationStats(org.id),
  }));
}

// ── כל ה-API Keys של ארגון ──
export function getApiKeysForOrg(orgId) {
  const result = [];
  for (const [key, oid] of apiKeys.entries()) {
    if (oid === orgId) result.push(key);
  }
  return result;
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

// ── ניהול משתמשים (User Tracking) ──

/**
 * Calculate risk level based on block count and categories.
 * @param {{ totalBlocks: number, categoryBreakdown: Record<string,number> }} user
 * @returns {"low"|"medium"|"high"|"critical"}
 */
const CREDIT_CARD_CATEGORY = "CREDIT_CARD";

export function calculateRiskLevel(user) {
  const blocks = user.totalBlocks || 0;
  let level;
  if (blocks <= 5) level = "low";
  else if (blocks <= 15) level = "medium";
  else if (blocks <= 30) level = "high";
  else level = "critical";

  // bump up one level if any CREDIT_CARD blocks exist
  const hasCreditCard = (user.categoryBreakdown?.[CREDIT_CARD_CATEGORY] || 0) > 0;
  if (hasCreditCard) {
    if (level === "low") level = "medium";
    else if (level === "medium") level = "high";
    else if (level === "high") level = "critical";
  }
  return level;
}

/**
 * Record activity for a user (identified by email).
 * @param {string} email
 * @param {string} category  - PII category (e.g. "PHONE", "CREDIT_CARD")
 * @param {object} [details] - optional extra details
 */
export function recordUserActivity(email, category, details = {}) {
  if (!email) return;
  const existing = users.get(email) || {
    email,
    totalBlocks: 0,
    categoryBreakdown: {},
    lastActivity: null,
    firstSeen: new Date().toISOString(),
  };

  existing.totalBlocks += 1;
  existing.categoryBreakdown[category] = (existing.categoryBreakdown[category] || 0) + 1;
  existing.lastActivity = new Date().toISOString();
  if (details.source) existing.lastSource = details.source;

  // derive topCategory
  const breakdown = existing.categoryBreakdown;
  existing.topCategory = Object.keys(breakdown).sort((a, b) => breakdown[b] - breakdown[a])[0] || category;

  existing.riskLevel = calculateRiskLevel(existing);

  users.set(email, existing);
  return existing;
}

/**
 * Get stats for a single user.
 * @param {string} email
 */
export function getUserStats(email) {
  return users.get(email) || null;
}

/**
 * Get all users sorted by totalBlocks descending.
 */
export function getAllUsers() {
  return [...users.values()].sort((a, b) => b.totalBlocks - a.totalBlocks);
}
