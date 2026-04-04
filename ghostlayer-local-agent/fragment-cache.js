/**
 * fragment-cache.js – Short-Term Memory for Fragmentation Attack Defense
 *
 * Maintains a 5-minute sliding-window cache of paste/input fragments per user.
 * When the same user sends multiple fragments that together form sensitive data
 * (e.g. first half of a credit-card number, then the second half), this module
 * detects the combination and flags it as a fragmentation attack.
 *
 * Also implements lightweight User Behavior Analytics (UBA) that builds a
 * per-user baseline and raises a risk flag when anomalous behaviour is detected.
 *
 * All data is in-memory only – nothing is written to disk.
 *
 * @module fragment-cache
 */

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
 *   UNUSUAL_CONTENT_SHIFT  – user suddenly pastes a very different content type
 *   HIGH_PASTE_RATE        – more than 10 pastes in 1 minute
 *   LARGE_PASTE            – single paste > 5 000 chars
 *   FRAGMENTATION_PATTERN  – 3+ consecutive pastes of incomplete-looking data
 *   CREDENTIAL_ANOMALY     – credential content from a user who never does this
 *   FINANCIAL_ANOMALY      – financial data from a user who never does this
 *
 * @param {string}   userEmail
 * @param {string}   text
 * @param {string[]} evasionTechniques  Evasion techniques detected in this paste.
 * @returns {{
 *   riskScore: number,
 *   anomalyFlags: string[],
 *   requiresMFA: boolean,
 * }}
 */
export function updateUserProfile(userEmail, text, evasionTechniques = []) {
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

  // ── Risk score (0–100) ──
  const riskScore = Math.min(
    100,
    (anomalyFlags.includes("HIGH_PASTE_RATE")          ? 20 : 0) +
    (anomalyFlags.includes("LARGE_PASTE")              ? 10 : 0) +
    (anomalyFlags.includes("FINANCIAL_ANOMALY")        ? 30 : 0) +
    (anomalyFlags.includes("CREDENTIAL_ANOMALY")       ? 30 : 0) +
    (anomalyFlags.includes("UNUSUAL_CONTENT_SHIFT")    ? 20 : 0) +
    (anomalyFlags.includes("EVASION_DETECTED")         ? 25 : 0) +
    (anomalyFlags.includes("SOCIAL_ENGINEERING_ATTEMPT")? 35 : 0),
  );

  profile.riskScore    = riskScore;
  profile.anomalyFlags = anomalyFlags;
  _profileStore.set(key, profile);

  // MFA required for high-risk anomalies
  const requiresMFA = riskScore >= 50 ||
    anomalyFlags.includes("FINANCIAL_ANOMALY") ||
    anomalyFlags.includes("CREDENTIAL_ANOMALY") ||
    anomalyFlags.includes("SOCIAL_ENGINEERING_ATTEMPT");

  return { riskScore, anomalyFlags, requiresMFA };
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
