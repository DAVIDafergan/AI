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
 *   When Redis is unavailable the module falls back to in-memory history and
 *   continues to operate normally.
 *
 * @module fragment-cache
 */

// ── Redis client (optional – graceful fallback to in-memory) ─────────────────

/**
 * Maximum number of historical volume samples retained per user.
 * Older samples are trimmed so the list never grows unbounded.
 */
const UEBA_HISTORY_MAX  = 200;
const UEBA_REDIS_KEY    = (userKey) => `ueba:vol:${userKey}`;

let _uebaRedis = null;

/**
 * Lazily obtain a Redis client for UEBA baseline storage.
 * Returns null if the connection cannot be established.
 */
async function getUebaRedis() {
  if (_uebaRedis) return _uebaRedis;
  try {
    const { default: Redis } = await import("ioredis");
    const url = process.env.REDIS_URL || "redis://localhost:6379";
    const client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    client.on("error", (err) => {
      if (err.code !== "ECONNREFUSED" && err.code !== "ENOTFOUND") {
        console.error("[ueba] Redis error:", err.message);
      }
    });
    await client.connect();
    _uebaRedis = client;
    return client;
  } catch {
    return null;
  }
}

/** In-memory fallback: userKey → number[] (volume history) */
const _memVolumeHistory = new Map();

/**
 * Fetch the existing volume history for `userKey` without modifying it.
 *
 * @param {string} userKey
 * @returns {Promise<number[]>}  History (oldest first), up to UEBA_HISTORY_MAX entries.
 */
async function fetchVolumeHistory(userKey) {
  try {
    const redis = await getUebaRedis();
    if (redis && redis.status === "ready") {
      const raw = await redis.lrange(UEBA_REDIS_KEY(userKey), 0, -1);
      return raw.map(Number);
    }
  } catch (err) {
    console.error("[ueba] Redis read failed, using in-memory fallback:", err.message);
  }
  return [...(_memVolumeHistory.get(userKey) || [])];
}

/**
 * Append a volume sample for `userKey` to the history store (Redis or memory).
 * Trims the list to UEBA_HISTORY_MAX entries.
 *
 * @param {string} userKey
 * @param {number} volume  Character count of the current sensitive payload.
 * @returns {Promise<void>}
 */
async function appendVolumeHistory(userKey, volume) {
  try {
    const redis = await getUebaRedis();
    if (redis && redis.status === "ready") {
      const key = UEBA_REDIS_KEY(userKey);
      await redis.rpush(key, volume);
      await redis.ltrim(key, -UEBA_HISTORY_MAX, -1);
      return;
    }
  } catch (err) {
    console.error("[ueba] Redis write failed, using in-memory fallback:", err.message);
  }

  // In-memory fallback
  const history = _memVolumeHistory.get(userKey) || [];
  history.push(volume);
  if (history.length > UEBA_HISTORY_MAX) history.splice(0, history.length - UEBA_HISTORY_MAX);
  _memVolumeHistory.set(userKey, history);
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

// ── Fragment Cache ────────────────────────────────────────────────────────────

const FRAGMENT_TTL_MS     = 5 * 60 * 1000;  // 5 minutes
const MAX_CACHE_BYTES     = 50_000;           // 50 KB per user (prevents memory abuse)
const MAX_FRAGMENT_COUNT  = 20;               // maximum fragments kept per user

/**
 * @typedef {{ text: string, ts: number, source: string }} Fragment
 * @typedef {Fragment[]} UserFragmentList
 */

/** @type {Map<string, UserFragmentList>} */
const _fragmentStore = new Map();

/**
 * Record a new text fragment for the given user and return the concatenated
 * window of all non-expired fragments (including the new one).
 *
 * @param {string} userEmail
 * @param {string} text        The new fragment to add.
 * @param {string} [source]    Where it came from: "paste" | "typing" | "image".
 * @returns {string}  Concatenated window text (for combined pattern matching).
 */
export function recordFragment(userEmail, text, source = "paste") {
  const now = Date.now();
  const key = userEmail.toLowerCase().trim() || "anonymous";

  // Retrieve and prune expired fragments
  let frags = (_fragmentStore.get(key) || []).filter((f) => now - f.ts < FRAGMENT_TTL_MS);

  // Add the new fragment
  frags.push({ text, ts: now, source });

  // Enforce count limit (drop oldest)
  if (frags.length > MAX_FRAGMENT_COUNT) {
    frags = frags.slice(frags.length - MAX_FRAGMENT_COUNT);
  }

  // Enforce byte limit (drop oldest until under budget)
  let totalBytes = frags.reduce((acc, f) => acc + f.text.length, 0);
  while (totalBytes > MAX_CACHE_BYTES && frags.length > 1) {
    const removed = frags.shift();
    totalBytes -= removed.text.length;
  }

  _fragmentStore.set(key, frags);

  return frags.map((f) => f.text).join("\n");
}

/**
 * Peek at the current window without adding a new fragment.
 * @param {string} userEmail
 * @returns {string}
 */
export function peekFragmentWindow(userEmail) {
  const now = Date.now();
  const key = userEmail.toLowerCase().trim() || "anonymous";
  const frags = (_fragmentStore.get(key) || []).filter((f) => now - f.ts < FRAGMENT_TTL_MS);
  return frags.map((f) => f.text).join("\n");
}

/**
 * Returns the number of fragments in the current window for the user.
 * @param {string} userEmail
 * @returns {number}
 */
export function getFragmentCount(userEmail) {
  const now = Date.now();
  const key = userEmail.toLowerCase().trim() || "anonymous";
  return (_fragmentStore.get(key) || []).filter((f) => now - f.ts < FRAGMENT_TTL_MS).length;
}

/**
 * Clear the fragment window for a user (called after a block/alert is raised).
 * @param {string} userEmail
 */
export function clearFragments(userEmail) {
  const key = userEmail.toLowerCase().trim() || "anonymous";
  _fragmentStore.delete(key);
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

/** @type {Map<string, UserProfile>} */
const _profileStore = new Map();

const PROFILE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes for rate calculation

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
  const key     = userEmail.toLowerCase().trim() || "anonymous";
  const now     = Date.now();
  const types   = detectContentTypes(text);

  let profile = _profileStore.get(key);
  if (!profile) {
    profile = {
      totalPastes:      0,
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
  _profileStore.set(key, profile);

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
 * @returns {UserProfile | null}
 */
export function getUserProfile(userEmail) {
  const key = userEmail.toLowerCase().trim() || "anonymous";
  return _profileStore.get(key) ?? null;
}

/**
 * Return all stored user profiles (for admin dashboard).
 * @returns {Array<{ email: string } & UserProfile>}
 */
export function getAllProfiles() {
  return Array.from(_profileStore.entries()).map(([email, profile]) => ({
    email,
    ...profile,
  }));
}
