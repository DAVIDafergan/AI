/**
 * fragment-cache.js – Short-Term Memory for Fragmentation Attack Defense
 *
 * Maintains a 5-minute sliding-window cache of paste/input fragments per user.
 * When the same user sends multiple fragments that together form sensitive data
 * (e.g. first half of a credit-card number, then the second half), this module
 * detects the combination and flags it as a fragmentation attack.
 *
 * Also implements Advanced User and Entity Behavior Analytics (UEBA) that builds
 * a per-user baseline and raises a risk flag when anomalous behaviour is detected.
 *
 * Statistical Anomaly Detection (Z-score / 3σ rule):
 *   A running history of sensitive-data volumes (character counts) is stored in
 *   Redis (key: ueba:vol:<userKey>).  On each event we compute the Z-score of
 *   the current volume against that history.  If Z > 3 the event is flagged
 *   STATISTICAL_ANOMALY_3SIGMA with severity "Critical" and requiresMFA = true.
 *   When Redis is unavailable the module falls back gracefully to in-memory.
 *
 * State is persisted in Redis so it survives agent restarts and supports
 * multi-process deployments.  Each function is async because Redis I/O is
 * asynchronous.  Falls back gracefully to no-op behaviour if Redis is
 * unavailable, allowing the agent to continue running in degraded mode.
 *
 * Redis key layout:
 *   frag:{userKey}     – JSON array of Fragment objects; TTL = FRAGMENT_TTL_SEC
 *   profile:{userKey}  – JSON object of UserProfile; no TTL (persistent baseline)
 *   ueba:vol:{userKey} – Redis list of volume history numbers (rpush/ltrim)
 *
 * @module fragment-cache
 */

import { getRedisClient } from "./redis-client.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const FRAGMENT_TTL_MS    = 5 * 60 * 1000;  // 5 minutes (ms, for per-fragment filtering)
const FRAGMENT_TTL_SEC   = 5 * 60;          // 5 minutes (seconds, for Redis key TTL)
const MAX_CACHE_BYTES    = 50_000;           // 50 KB per user (prevents memory abuse)
const MAX_FRAGMENT_COUNT = 20;               // maximum fragments kept per user
const UEBA_HISTORY_MAX   = 200;              // max volume-history samples per user
const UEBA_REDIS_KEY     = (key) => `ueba:vol:${key}`;

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Normalise email into a Redis-safe key segment. */
function userKey(userEmail) {
  return (userEmail || "").toLowerCase().trim() || "anonymous";
}

// ── Statistical helpers ───────────────────────────────────────────────────────

/**
 * Compute the population mean of an array of numbers.
 * @param {number[]} values
 * @returns {number}
 */
function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Compute the population standard deviation of an array of numbers.
 * @param {number[]} values
 * @param {number}   [mu]   Pre-computed mean (optional, avoids second pass).
 * @returns {number}
 */
function stddev(values, mu) {
  if (values.length < 2) return 0;
  const m = mu !== undefined ? mu : mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Compute the Z-score of `value` against the provided historical sample set.
 * Returns 0 when the history is too small (< 2 points) to be meaningful.
 *
 * @param {number}   value    The current observation.
 * @param {number[]} history  Historical observations (the new value should NOT
 *                            be included – pass the list *before* appending).
 * @returns {number}  Z-score (positive = above average, negative = below).
 */
export function computeZScore(value, history) {
  if (history.length < 2) return 0;
  const mu = mean(history);
  const sigma = stddev(history, mu);
  if (sigma === 0) return 0;
  return (value - mu) / sigma;
}

// ── UEBA volume history ───────────────────────────────────────────────────────

/** In-memory fallback: userKey → number[] (volume history) */
const _memVolumeHistory = new Map();

/**
 * Fetch the existing volume history for `key` without modifying it.
 * @param {string} key  Normalised user key.
 * @returns {Promise<number[]>}  History (oldest first), up to UEBA_HISTORY_MAX entries.
 */
async function fetchVolumeHistory(key) {
  try {
    const raw = await getRedisClient().lrange(UEBA_REDIS_KEY(key), 0, -1);
    return raw.map(Number);
  } catch {
    return [...(_memVolumeHistory.get(key) || [])];
  }
}

/**
 * Append a volume sample for `key` to the history store and trim to UEBA_HISTORY_MAX.
 * @param {string} key
 * @param {number} volume  Character count of the current sensitive payload.
 * @returns {Promise<void>}
 */
async function appendVolumeHistory(key, volume) {
  try {
    const redisKey = UEBA_REDIS_KEY(key);
    await getRedisClient().rpush(redisKey, volume);
    await getRedisClient().ltrim(redisKey, -UEBA_HISTORY_MAX, -1);
    return;
  } catch { /* fall through to in-memory */ }

  // In-memory fallback
  const history = _memVolumeHistory.get(key) || [];
  history.push(volume);
  if (history.length > UEBA_HISTORY_MAX) history.splice(0, history.length - UEBA_HISTORY_MAX);
  _memVolumeHistory.set(key, history);
}

// ── Fragment Cache ────────────────────────────────────────────────────────────

/**
 * @typedef {{ text: string, ts: number, source: string }} Fragment
 * @typedef {Fragment[]} UserFragmentList
 */

/**
 * Read, prune expired fragments, apply limits, persist the updated list, and
 * return the pruned array.  Extracted so recordFragment and read-only helpers
 * share the same pruning logic.
 *
 * @param {string}       key    Redis field key (userKey)
 * @param {Fragment[]}   frags  Raw array loaded from Redis (may include expired).
 * @param {Fragment|null} add   Optional new fragment to append before pruning.
 * @returns {{ frags: Fragment[], changed: boolean }}
 */
function pruneFragments(frags, add) {
  const now     = Date.now();
  let   updated = frags.filter((f) => now - f.ts < FRAGMENT_TTL_MS);
  let   changed = updated.length !== frags.length;

  if (add) {
    updated.push(add);
    changed = true;
  }

  // Enforce count limit
  if (updated.length > MAX_FRAGMENT_COUNT) {
    updated = updated.slice(updated.length - MAX_FRAGMENT_COUNT);
    changed = true;
  }

  // Enforce byte budget
  let totalBytes = updated.reduce((acc, f) => acc + (f?.text?.length || 0), 0);
  while (totalBytes > MAX_CACHE_BYTES && updated.length > 1) {
    const removed = updated.shift();
    totalBytes -= removed?.text?.length || 0;
    changed = true;
  }

  return { frags: updated, changed };
}

/** Load raw fragment array from Redis (or [] on miss/error). */
async function loadFragments(key) {
  try {
    const raw = await getRedisClient().get(`frag:${key}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Persist fragment array to Redis with a sliding 5-minute TTL. */
async function saveFragments(key, frags) {
  try {
    await getRedisClient().setex(`frag:${key}`, FRAGMENT_TTL_SEC, JSON.stringify(frags));
  } catch {
    // Non-fatal – worst case the fragment window is lost on the next read.
  }
}

/**
 * Record a new text fragment for the given user and return the concatenated
 * window of all non-expired fragments (including the new one).
 *
 * @param {string} userEmail
 * @param {string} text        The new fragment to add.
 * @param {string} [source]    Where it came from: "paste" | "typing" | "image".
 * @returns {Promise<string>}  Concatenated window text (for combined pattern matching).
 */
export async function recordFragment(userEmail, text, source = "paste") {
  const key  = userKey(userEmail);
  const raw  = await loadFragments(key);
  const now  = Date.now();
  const { frags } = pruneFragments(raw, { text, ts: now, source });
  await saveFragments(key, frags);
  return frags.map((f) => f.text).join("\n");
}

/**
 * Peek at the current window without adding a new fragment.
 * @param {string} userEmail
 * @returns {Promise<string>}
 */
export async function peekFragmentWindow(userEmail) {
  const key  = userKey(userEmail);
  const raw  = await loadFragments(key);
  const { frags, changed } = pruneFragments(raw, null);
  if (changed) await saveFragments(key, frags);
  return frags.map((f) => f.text).join("\n");
}

/**
 * Returns the number of fragments in the current window for the user.
 * @param {string} userEmail
 * @returns {Promise<number>}
 */
export async function getFragmentCount(userEmail) {
  const key  = userKey(userEmail);
  const raw  = await loadFragments(key);
  const { frags, changed } = pruneFragments(raw, null);
  if (changed) await saveFragments(key, frags);
  return frags.length;
}

/**
 * Clear the fragment window for a user (called after a block/alert is raised).
 * @param {string} userEmail
 * @returns {Promise<void>}
 */
export async function clearFragments(userEmail) {
  const key = userKey(userEmail);
  try {
    await getRedisClient().del(`frag:${key}`);
  } catch {
    // Non-fatal
  }
}

// ── User Behavior Analytics ───────────────────────────────────────────────────

/**
 * Content-type labels derived from lightweight heuristics.
 * @type {Record<string, RegExp>}
 */
const CONTENT_TYPE_SIGNALS = {
  CODE:        /(?:\bfunction\b|\bconst\b|\blet\b|\bvar\b|\bimport\b|\bclass\b|=>|!=|===|\/\/|#include|def )/,
  DATA_TABLE:  /(?:\t.+\t|\|.+\||\bcsv\b|,{3,}|\bexcel\b)/i,
  CREDENTIALS: /(?:password|secret|token|api[_\-]?key|credentials|passwd)/i,
  FINANCIAL:   /(?:\b(?:salary|payroll|revenue|invoice|credit|iban|swift)\b)/i,
  PII:         /(?:\b\d{9}\b|\b\d{13,16}\b|@[a-z]{2,}\.[a-z]{2,})/i,
  HEBREW_TEXT: /[\u05D0-\u05EA]{10,}/,
  ENGLISH_TEXT:/[A-Za-z]{50,}/,
};

/**
 * @typedef {{
 *   totalPastes: number,
 *   contentTypeCounts: Record<string, number>,
 *   lastSeen: number,
 *   pasteTimestamps: number[],
 *   avgPasteSize: number,
 *   riskScore: number,
 *   anomalyFlags: string[],
 * }} UserProfile
 */

const PROFILE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes for rate calculation

/** Load a user profile from Redis (or null on miss/error). */
async function loadProfile(key) {
  try {
    const raw = await getRedisClient().get(`profile:${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Persist a user profile to Redis (no TTL – profiles are long-lived baselines). */
async function saveProfile(key, profile) {
  try {
    await getRedisClient().set(`profile:${key}`, JSON.stringify(profile));
  } catch {
    // Non-fatal
  }
}

/**
 * Detect the content type(s) present in `text` using lightweight regexes.
 * @param {string} text
 * @returns {string[]}
 */
function detectContentTypes(text) {
  return Object.entries(CONTENT_TYPE_SIGNALS)
    .filter(([, re]) => re.test(text))
    .map(([label]) => label);
}

/**
 * Update the behavior profile for `userEmail` with a new paste event and
 * return an anomaly report.
 *
 * Anomaly signals (returned as strings in `anomalyFlags`):
 *   UNUSUAL_CONTENT_SHIFT      – user suddenly pastes a very different content type
 *   HIGH_PASTE_RATE            – more than 10 pastes in 1 minute
 *   LARGE_PASTE                – single paste > 5 000 chars
 *   FRAGMENTATION_PATTERN      – 3+ consecutive pastes of incomplete-looking data
 *   CREDENTIAL_ANOMALY         – credential content from a user who never does this
 *   FINANCIAL_ANOMALY          – financial data from a user who never does this
 *   STATISTICAL_ANOMALY_3SIGMA – current volume is > 3σ above historical baseline
 *
 * @param {string}   userEmail
 * @param {string}   text
 * @param {string[]} evasionTechniques  Evasion techniques detected in this paste.
 * @returns {Promise<{
 *   riskScore: number,
 *   anomalyFlags: string[],
 *   requiresMFA: boolean,
 *   severity: "Info" | "Low" | "Medium" | "High" | "Critical",
 *   zScore: number,
 * }>}
 */
export async function updateUserProfile(userEmail, text, evasionTechniques = []) {
  const key   = userKey(userEmail);
  const now   = Date.now();
  const types = detectContentTypes(text);

  let profile = await loadProfile(key);
  if (!profile) {
    profile = {
      totalPastes:       0,
      contentTypeCounts: {},
      lastSeen:          now,
      pasteTimestamps:   [],
      avgPasteSize:      0,
      riskScore:         0,
      anomalyFlags:      [],
    };
  }

  // ── Update core counters ──
  profile.totalPastes += 1;
  profile.lastSeen     = now;

  // Running average paste size (exponential moving average)
  const alpha = 0.1;
  profile.avgPasteSize = Math.round(
    alpha * text.length + (1 - alpha) * (profile.avgPasteSize || text.length),
  );

  // Track content types
  for (const ct of types) {
    profile.contentTypeCounts[ct] = (profile.contentTypeCounts[ct] || 0) + 1;
  }

  // Keep only recent paste timestamps for rate calculation
  profile.pasteTimestamps.push(now);
  profile.pasteTimestamps = profile.pasteTimestamps.filter(
    (ts) => now - ts < PROFILE_WINDOW_MS,
  );

  // ── Anomaly detection ──
  const anomalyFlags = [];

  // 1. High paste rate (> 10 pastes in 60 seconds)
  const pastesLastMinute = profile.pasteTimestamps.filter(
    (ts) => now - ts < 60_000,
  ).length;
  if (pastesLastMinute > 10) anomalyFlags.push("HIGH_PASTE_RATE");

  // 2. Large paste (> 5 000 chars, roughly 2 pages of text)
  if (text.length > 5000) anomalyFlags.push("LARGE_PASTE");

  // 3. Content-type shift – user is pasting a type they've never used before
  if (profile.totalPastes > 5) {
    const dominantType = Object.entries(profile.contentTypeCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    if (dominantType && types.length > 0) {
      const hasNewType = types.some((ct) => !(profile.contentTypeCounts[ct] > 1));
      if (hasNewType) {
        // A completely new content type for this user
        if (types.includes("FINANCIAL") && !profile.contentTypeCounts.FINANCIAL) {
          anomalyFlags.push("FINANCIAL_ANOMALY");
        }
        if (types.includes("CREDENTIALS") && !profile.contentTypeCounts.CREDENTIALS) {
          anomalyFlags.push("CREDENTIAL_ANOMALY");
        }
        if (types.includes("DATA_TABLE") && dominantType === "CODE") {
          anomalyFlags.push("UNUSUAL_CONTENT_SHIFT");
        }
      }
    }
  }

  // 4. Evasion technique used
  if (evasionTechniques.length > 0) {
    anomalyFlags.push("EVASION_DETECTED");
  }

  // 5. Roleplay injection
  if (evasionTechniques.includes("ROLEPLAY_INJECTION")) {
    anomalyFlags.push("SOCIAL_ENGINEERING_ATTEMPT");
  }

  // ── Statistical Anomaly Detection (Z-score / 3σ) ─────────────────────────
  // Fetch the historical volume baseline BEFORE recording this sample so the
  // current event is not included in the reference distribution.
  const volumeHistory = await fetchVolumeHistory(key).catch(() => []);
  const zScore = computeZScore(text.length, volumeHistory);

  // Record the new sample so it becomes part of the next event's baseline.
  await appendVolumeHistory(key, text.length).catch(() => {});

  // Flag as Critical if the current volume is > 3 standard deviations above
  // the user's personal baseline.  We require at least 10 historical samples
  // before the rule fires to avoid false-positives during the warm-up period.
  if (volumeHistory.length >= 10 && zScore > 3) {
    anomalyFlags.push("STATISTICAL_ANOMALY_3SIGMA");
  }

  // ── Risk score (0–100) ──
  const riskScore = Math.min(
    100,
    (anomalyFlags.includes("HIGH_PASTE_RATE")              ? 20 : 0) +
    (anomalyFlags.includes("LARGE_PASTE")                  ? 10 : 0) +
    (anomalyFlags.includes("FINANCIAL_ANOMALY")            ? 30 : 0) +
    (anomalyFlags.includes("CREDENTIAL_ANOMALY")           ? 30 : 0) +
    (anomalyFlags.includes("UNUSUAL_CONTENT_SHIFT")        ? 20 : 0) +
    (anomalyFlags.includes("EVASION_DETECTED")             ? 25 : 0) +
    (anomalyFlags.includes("SOCIAL_ENGINEERING_ATTEMPT")   ? 35 : 0) +
    (anomalyFlags.includes("STATISTICAL_ANOMALY_3SIGMA")   ? 40 : 0),
  );

  profile.riskScore    = riskScore;
  profile.anomalyFlags = anomalyFlags;
  await saveProfile(key, profile);

  // ── Severity classification ──────────────────────────────────────────────
  let severity;
  if (anomalyFlags.includes("STATISTICAL_ANOMALY_3SIGMA")) {
    severity = "Critical";
  } else if (riskScore >= 70) {
    severity = "High";
  } else if (riskScore >= 40) {
    severity = "Medium";
  } else if (riskScore >= 10) {
    severity = "Low";
  } else {
    severity = "Info";
  }

  // MFA required for high-risk anomalies or statistical outliers
  const requiresMFA = severity === "Critical" ||
    riskScore >= 50 ||
    anomalyFlags.includes("FINANCIAL_ANOMALY") ||
    anomalyFlags.includes("CREDENTIAL_ANOMALY") ||
    anomalyFlags.includes("SOCIAL_ENGINEERING_ATTEMPT");

  return { riskScore, anomalyFlags, requiresMFA, severity, zScore };
}

/**
 * Return the current profile for a user (read-only snapshot).
 * @param {string} userEmail
 * @returns {Promise<UserProfile | null>}
 */
export async function getUserProfile(userEmail) {
  const key = userKey(userEmail);
  return loadProfile(key);
}

/**
 * Return all stored user profiles (for admin dashboard).
 * Uses Redis SCAN to enumerate all profile:* keys without blocking.
 * @returns {Promise<Array<{ email: string } & UserProfile>>}
 */
export async function getAllProfiles() {
  const redis = getRedisClient();
  const keys  = [];
  let   cursor = "0";

  try {
    do {
      const [nextCursor, batch] = await redis.scan(cursor, "MATCH", "profile:*", "COUNT", "100");
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== "0");
  } catch {
    return [];
  }

  if (keys.length === 0) return [];

  const values = await redis.mget(...keys);
  const results = [];
  for (let i = 0; i < keys.length; i++) {
    if (values[i]) {
      try {
        const email   = keys[i].replace(/^profile:/, "");
        const profile = JSON.parse(values[i]);
        results.push({ email, ...profile });
      } catch {
        // Skip malformed entries
      }
    }
  }
  return results;
}

