// מסד נתונים – MongoDB-backed data access layer with Mongoose models

import { randomUUID } from "crypto";
import mongoose from "mongoose";

// ── MongoDB connection (used by new multi-tenant models) ──
// Cache the promise on a module-level global so that Next.js hot-reloads and
// concurrent requests share a single connection pool rather than spawning a new
// one on every invocation.
const _global = globalThis;

// Disable buffering globally – operations will throw immediately if there is no
// active connection instead of silently queuing and timing out after 10 s.
mongoose.set("bufferCommands", false);

export async function connectMongo() {
  if (!process.env.MONGODB_URI) {
    throw new Error(
      "[connectMongo] MONGODB_URI environment variable is not set. " +
        "Please configure it before starting the server."
    );
  }

  // Reuse an in-flight or resolved connection promise when one already exists.
  if (_global._mongooseConnectionPromise) {
    return _global._mongooseConnectionPromise;
  }

  // If mongoose already has an active connection (e.g. after module reload)
  // wrap it in a resolved promise and cache it.
  if (mongoose.connection.readyState === 1) {
    _global._mongooseConnectionPromise = Promise.resolve(mongoose.connection);
    return _global._mongooseConnectionPromise;
  }

  _global._mongooseConnectionPromise = mongoose
    .connect(process.env.MONGODB_URI)
    .catch((err) => {
      // Clear the cache so the next call retries instead of getting a rejected
      // promise forever.
      _global._mongooseConnectionPromise = null;
      console.error("[connectMongo] Failed to connect:", err.message);
      throw err;
    });

  return _global._mongooseConnectionPromise;
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
    serverUrl: { type: String, default: "" },
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

// ── VaultMapping Schema (synthetic → original text) ──
const VaultMappingSchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    tag:            { type: String, required: true, unique: true, index: true },
    originalText:   { type: String, required: true },
    category:       { type: String, default: "" },
    label:          { type: String, default: "" },
    source:         { type: String, default: "" },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } }
);

// ── ApiKey Schema ──
const ApiKeySchema = new mongoose.Schema(
  {
    key:            { type: String, required: true, unique: true },
    organizationId: { type: String, required: true, index: true },
  },
  { timestamps: true }
);

export const VaultMapping = mongoose.models.VaultMapping || mongoose.model("VaultMapping", VaultMappingSchema);
export const ApiKey = mongoose.models.ApiKey || mongoose.model("ApiKey", ApiKeySchema);

// ── In-memory stores for non-migrated data ──
const policies = new Map();      // organizationId → [ policy, ... ]
const customKeywords = new Map();// organizationId → [ keyword, ... ]
const alerts = new Map();        // alertId → alertData
const users = new Map();         // email → userStatsObject

// ── ניהול ארגונים ──
export async function createOrganization({ name, contactEmail = "", plan = "basic", notes = "", status = "active", initialPolicy = [] } = {}) {
  await connectMongo();
  const newApiKeyValue = `key-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const slug = (name || "org")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40) + "-" + randomUUID().slice(0, 8);
  const mongoStatus = ["active", "suspended", "trial", "expired"].includes(status) ? status : "trial";
  const mongoPlan =
    plan === "pro" ? "professional" :
    plan === "enterprise" ? "enterprise" :
    "starter";
  const org = await Tenant.create({
    name: name || "ארגון חדש",
    slug,
    apiKey: newApiKeyValue,
    apiSecret: randomUUID(),
    contactEmail: contactEmail || "noreply@example.com",
    plan: mongoPlan,
    status: mongoStatus,
  });
  await ApiKey.create({ key: newApiKeyValue, organizationId: org._id.toString() });
  if (initialPolicy && initialPolicy.length > 0) {
    policies.set(org._id.toString(), initialPolicy);
  }
  return {
    id: org._id.toString(),
    name: org.name,
    createdAt: org.createdAt.toISOString(),
    contactEmail: org.contactEmail,
    plan,
    notes,
    status,
    settings: { language: "he", timezone: "Asia/Jerusalem" },
    apiKey: newApiKeyValue,
  };
}

export async function getOrganization(orgId) {
  await connectMongo();
  let tenant = null;
  try {
    tenant = await Tenant.findById(orgId).lean();
  } catch {
    tenant = await Tenant.findOne({ slug: orgId }).lean();
  }
  if (!tenant) return null;
  return {
    id: tenant._id.toString(),
    name: tenant.name,
    createdAt: tenant.createdAt?.toISOString?.() || new Date().toISOString(),
    contactEmail: tenant.contactEmail || "",
    plan: tenant.plan || "starter",
    notes: "",
    status: tenant.status || "active",
    settings: tenant.settings || { language: "he", timezone: "Asia/Jerusalem" },
  };
}

export async function getAllOrganizations() {
  await connectMongo();
  const tenants = await Tenant.find().lean();
  return tenants.map((t) => ({
    id: t._id.toString(),
    name: t.name,
    createdAt: t.createdAt?.toISOString?.() || new Date().toISOString(),
    contactEmail: t.contactEmail || "",
    plan: t.plan || "starter",
    notes: "",
    status: t.status || "active",
    settings: t.settings || {},
  }));
}

export async function updateOrganization(orgId, updates) {
  await connectMongo();
  const mongoUpdates = {};
  if (updates.name)         mongoUpdates.name         = updates.name;
  if (updates.contactEmail) mongoUpdates.contactEmail = updates.contactEmail;
  if (updates.status)       mongoUpdates.status       = updates.status;
  if (updates.plan) {
    mongoUpdates.plan =
      updates.plan === "pro" ? "professional" :
      updates.plan === "enterprise" ? "enterprise" :
      "starter";
  }
  let tenant = null;
  try {
    tenant = await Tenant.findByIdAndUpdate(orgId, { $set: mongoUpdates }, { new: true }).lean();
  } catch {
    tenant = await Tenant.findOneAndUpdate({ slug: orgId }, { $set: mongoUpdates }, { new: true }).lean();
  }
  if (!tenant) return null;
  return {
    id: tenant._id.toString(),
    name: tenant.name,
    createdAt: tenant.createdAt?.toISOString?.() || new Date().toISOString(),
    contactEmail: tenant.contactEmail || "",
    plan: tenant.plan || "starter",
    notes: updates.notes || "",
    status: tenant.status || "active",
    settings: tenant.settings || {},
  };
}

// ── מחיקת ארגון + כל הנתונים הקשורים ──
export async function deleteOrganization(orgId) {
  await connectMongo();
  let tenant = null;
  try {
    tenant = await Tenant.findByIdAndDelete(orgId).lean();
  } catch {
    tenant = await Tenant.findOneAndDelete({ slug: orgId }).lean();
  }
  if (!tenant) return false;
  const resolvedId = tenant._id.toString();
  await Promise.all([
    ApiKey.deleteMany({ organizationId: resolvedId }),
    VaultMapping.deleteMany({ organizationId: resolvedId }),
    TenantEvent.deleteMany({ tenantId: tenant._id }),
  ]);
  policies.delete(resolvedId);
  customKeywords.delete(resolvedId);
  return true;
}

// ── סטטיסטיקות מהירות לארגון ──
export async function getOrganizationStats(orgId) {
  await connectMongo();
  let tenantId;
  try {
    tenantId = new mongoose.Types.ObjectId(orgId);
  } catch {
    return { totalBlocked: 0, lastBlockedAt: null, avgThreatScore: 0 };
  }
  const [totalBlocked, agg] = await Promise.all([
    TenantEvent.countDocuments({ tenantId, eventType: "block" }),
    TenantEvent.aggregate([
      { $match: { tenantId, eventType: "block" } },
      {
        $group: {
          _id: null,
          avgThreat: { $avg: { $ifNull: ["$details.threatScore", 0] } },
          lastAt:    { $max: "$timestamp" },
        },
      },
    ]),
  ]);
  const avgThreatScore = agg[0] ? Math.round(agg[0].avgThreat || 0) : 0;
  const lastBlockedAt  = agg[0]?.lastAt?.toISOString?.() || null;
  return { totalBlocked, lastBlockedAt, avgThreatScore };
}

// ── כל הארגונים עם סטטיסטיקות ──
export async function getAllOrganizationsWithStats() {
  const orgs = await getAllOrganizations();
  return Promise.all(
    orgs.map(async (org) => ({
      ...org,
      stats: await getOrganizationStats(org.id),
    }))
  );
}

// ── כל ה-API Keys של ארגון ──
export async function getApiKeysForOrg(orgId) {
  await connectMongo();
  const docs = await ApiKey.find({ organizationId: orgId }).lean();
  return docs.map((d) => d.key);
}

// ── ניהול API Keys ──
export async function validateApiKey(key) {
  await connectMongo();
  // Try the dedicated ApiKey collection first
  const apiKeyDoc = await ApiKey.findOne({ key }).lean();
  if (apiKeyDoc) {
    let tenant = null;
    try {
      tenant = await Tenant.findById(apiKeyDoc.organizationId).lean();
    } catch { /* invalid ObjectId */ }
    if (!tenant) return null;
    return { organizationId: apiKeyDoc.organizationId, orgName: tenant.name };
  }
  // Fallback: Tenant.apiKey field (for tenants provisioned via super-admin)
  const tenant = await Tenant.findOne({ apiKey: key }).lean();
  if (!tenant) return null;
  return { organizationId: tenant._id.toString(), orgName: tenant.name };
}

export async function createApiKey(orgId) {
  await connectMongo();
  const key = `key-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await ApiKey.create({ key, organizationId: orgId });
  return key;
}

// ── שמירת מיפוי (synthetic → original) ──
export async function saveMappings(organizationId, entries) {
  await connectMongo();
  const docs = entries.map((entry) => ({
    organizationId,
    tag: entry.tag,
    originalText: entry.originalText,
    category: entry.category || "",
    label: entry.label || "",
    source: entry.source || "",
  }));
  // ordered:false so a duplicate-tag error on one entry won't abort the rest
  const saved = await VaultMapping.insertMany(docs, { ordered: false }).catch((err) => {
    // Ignore duplicate-key errors (E11000); surface anything else
    if (err.code !== 11000 && err?.writeErrors?.every?.((e) => e.code === 11000)) throw err;
    return err.insertedDocs || [];
  });
  return saved;
}

export async function getMappings(organizationId, limit = 100) {
  await connectMongo();
  const query = organizationId ? { organizationId } : {};
  return VaultMapping.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

export async function getMappingByTag(tag) {
  await connectMongo();
  return VaultMapping.findOne({ tag }).lean();
}

// ── שמירת לוג ──
export async function saveLog(organizationId, entry) {
  await connectMongo();
  let tenantId;
  try {
    tenantId = new mongoose.Types.ObjectId(organizationId);
  } catch {
    return null; // organizationId is not a valid ObjectId
  }
  const eventType =
    entry.status === "blocked" || (entry.detectionCount || 0) > 0 ? "block" : "scan";
  const score = entry.threatScore || 0;
  const severity =
    score >= 80 ? "critical" :
    score >= 50 ? "high" :
    score >= 20 ? "medium" : "low";
  return TenantEvent.create({
    tenantId,
    eventType,
    severity,
    category: entry.type || entry.category || "",
    userEmail: entry.userEmail || "",
    details: {
      type: entry.type,
      synthetic: entry.synthetic,
      originalText: entry.originalText,
      source: entry.source,
      status: entry.status,
      threatScore: entry.threatScore,
      detectionCount: entry.detectionCount,
      replacements: entry.replacements,
    },
  });
}

export async function getLogs(organizationId, limit = 50) {
  await connectMongo();
  const query = {};
  if (organizationId) {
    try {
      query.tenantId = new mongoose.Types.ObjectId(organizationId);
    } catch {
      return [];
    }
  }
  const docs = await TenantEvent.find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
  return docs.map((doc) => ({
    id: doc._id.toString(),
    organizationId: doc.tenantId?.toString() || "",
    timestamp: doc.timestamp?.toISOString?.() || new Date().toISOString(),
    type: doc.details?.type || doc.category || doc.eventType || "UNKNOWN",
    synthetic: doc.details?.synthetic || "",
    originalText: doc.details?.originalText || "",
    source: doc.details?.source || "unknown",
    status: doc.details?.status || (doc.eventType === "block" ? "blocked" : "clean"),
    threatScore: doc.details?.threatScore || 0,
    detectionCount: doc.details?.detectionCount || 0,
    replacements: doc.details?.replacements || [],
    userEmail: doc.userEmail || "",
  }));
}

// ── סטטיסטיקות דינמיות ──
export async function getStats(organizationId) {
  const [orgLogs, orgMappings] = await Promise.all([
    getLogs(organizationId, 10000),
    getMappings(organizationId, 10000),
  ]);

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
export async function getTrendData(organizationId) {
  const orgLogs = await getLogs(organizationId, 10000);

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
export async function generateReport(organizationId) {
  const [org, stats, orgLogs, orgPolicies, orgKeywords, trendData] = await Promise.all([
    getOrganization(organizationId),
    getStats(organizationId),
    getLogs(organizationId, 1000),
    Promise.resolve(getPolicies(organizationId) || []),
    Promise.resolve(getCustomKeywords(organizationId)),
    getTrendData(organizationId),
  ]);

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
export async function getMappingBySynthetic(syntheticValue) {
  const doc = await getMappingByTag(syntheticValue);
  if (!doc) return null;
  // normalize to the shape expected by restore-batch
  return {
    synthetic: doc.tag,
    original: doc.originalText,
    category: doc.category,
    label: doc.label,
    timestamp: doc.createdAt?.toISOString?.() || doc.createdAt,
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
