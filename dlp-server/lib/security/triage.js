/**
 * lib/security/triage.js
 *
 * Multi-Layer Triage Engine – Ultra-Low Latency DLP Pre-Screening
 * ────────────────────────────────────────────────────────────────
 * L1 (<1 ms)  – Bloom filter against a dictionary of known secret keywords
 * L2 (<5 ms)  – Regex patterns for PII (email, phone, credit card, ID, etc.)
 * L3 (async)  – Semantic vector search (delegates to semantic-search.js)
 *
 * Only text that passes L1 AND L2 clean, or is flagged as ambiguous by L2,
 * is escalated to the expensive L3 stage.
 */

import { semanticSearch } from "../ai-brain/semantic-search.js";

// ─────────────────────────────────────────────────────────────────────────────
// L1 – Bloom Filter  (<1 ms)
// ─────────────────────────────────────────────────────────────────────────────

const BLOOM_SIZE       = 4096; // bits
const BLOOM_HASH_COUNT = 4;

/**
 * Deterministic 32-bit FNV-1a variant hash (seed-extended).
 * @param {string} str
 * @param {number} seed
 * @returns {number}
 */
function bloomHash(str, seed) {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h  = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % BLOOM_SIZE;
}

/**
 * Build a compact Bloom filter bit-array from a word list.
 * @param {string[]} words
 * @returns {Uint8Array}
 */
function buildBloomFilter(words) {
  const bits = new Uint8Array(Math.ceil(BLOOM_SIZE / 8));
  for (const w of words) {
    const norm = w.toLowerCase();
    for (let s = 0; s < BLOOM_HASH_COUNT; s++) {
      const bit = bloomHash(norm, s * 2654435761);
      bits[bit >>> 3] |= 1 << (bit & 7);
    }
  }
  return bits;
}

/**
 * Test whether a word is (probably) in the filter.
 * False-positive rate: ~3 % at the current size/hash-count ratio.
 * @param {Uint8Array} bits
 * @param {string} word
 * @returns {boolean}
 */
function bloomContains(bits, word) {
  const norm = word.toLowerCase();
  for (let s = 0; s < BLOOM_HASH_COUNT; s++) {
    const bit = bloomHash(norm, s * 2654435761);
    if (!(bits[bit >>> 3] & (1 << (bit & 7)))) return false;
  }
  return true;
}

/** Master dictionary of known sensitive keywords (English + Hebrew). */
const SENSITIVE_KEYWORDS = [
  // credentials
  "password", "passwd", "passphrase", "secret", "credential", "credentials",
  "api_key", "apikey", "api-key", "access_token", "access-token", "auth_token",
  "bearer", "private_key", "private-key", "client_secret", "client-secret",
  "jwt", "oauth", "refresh_token", "signing_key", "encryption_key", "master_key",
  // financial
  "credit", "debit", "cvv", "cvc", "ssn", "social-security", "iban", "swift",
  "routing", "account-number", "bank-account", "payment",
  // PII
  "passport", "driver-license", "national-id", "tax-id", "ein", "dob", "date-of-birth",
  // Hebrew equivalents
  "סיסמה", "סיסמא", "מפתח", "סודי", "פרטי", "אישי", "אסור", "חשאי",
  "כרטיס-אשראי", "מספר-זהות", "מספר-חשבון",
];

const BLOOM_FILTER = buildBloomFilter(SENSITIVE_KEYWORDS);

/**
 * L1 scan: tokenise input and probe the Bloom filter for each word.
 * @param {string} text
 * @returns {{ hit: boolean, matchedWords: string[], elapsedMs: number }}
 */
function l1Scan(text) {
  const t0           = performance.now();
  const words        = text.toLowerCase().split(/\W+/).filter(Boolean);
  const matchedWords = [];

  for (const w of words) {
    if (bloomContains(BLOOM_FILTER, w)) matchedWords.push(w);
  }

  return { hit: matchedWords.length > 0, matchedWords, elapsedMs: performance.now() - t0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// L2 – PII Regex Patterns  (<5 ms)
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Array<{ id: string, label: string, pattern: RegExp, confidence: "high"|"medium" }>} */
const L2_PATTERNS = [
  { id: "EMAIL",       label: "כתובת מייל",        confidence: "high",   pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g },
  { id: "PHONE_IL",    label: "טלפון ישראלי",       confidence: "high",   pattern: /\b0(?:5[0-9]|[2-9])[- ]?\d{3}[- ]?\d{4}\b/g },
  { id: "PHONE_INTL",  label: "טלפון בינ\"ל",       confidence: "high",   pattern: /\+\d{1,3}[\s\-]\d{1,4}[\s\-]\d{3,4}[\s\-]\d{3,4}\b/g },
  { id: "CREDIT_CARD", label: "מספר כרטיס אשראי",  confidence: "high",   pattern: /\b(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13}|6(?:011|5\d{2})\d{12})\b/g },
  { id: "NATIONAL_ID", label: "מספר זהות",          confidence: "high",   pattern: /\b\d{9}\b/g },
  { id: "IBAN",        label: "מספר IBAN",           confidence: "high",   pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}(?:[A-Z0-9]?){0,16}\b/g },
  { id: "IPV4",        label: "כתובת IP",            confidence: "medium", pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g },
  { id: "SSN_US",      label: "SSN אמריקאי",         confidence: "high",   pattern: /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g },
  { id: "API_TOKEN",   label: "מפתח API / Token",   confidence: "medium", pattern: /\b(?:sk|pk|rk|ey|gh[pos]|glpat|xox[boaprs]|AIza|ya29)[A-Za-z0-9_\-]{16,}\b/g },
  { id: "PRIVATE_KEY", label: "מפתח פרטי (PEM)",    confidence: "high",   pattern: /-----BEGIN(?:\s\w+)?\s+PRIVATE KEY-----/g },
  { id: "PASSPORT",    label: "מספר דרכון",          confidence: "medium", pattern: /\b[A-Z]{1,2}\d{6,9}\b/g },
];

/**
 * @typedef {{ id: string, label: string, confidence: string, matches: string[] }} L2Match
 */

/**
 * L2 scan: run all PII regex patterns against the input.
 * @param {string} text
 * @returns {{ hit: boolean, ambiguous: boolean, matches: L2Match[], elapsedMs: number }}
 */
function l2Scan(text) {
  const t0    = performance.now();
  /** @type {L2Match[]} */
  const found = [];

  for (const { id, label, pattern, confidence } of L2_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches) found.push({ id, label, confidence, matches });
  }

  const highHit  = found.some((m) => m.confidence === "high");
  const medHit   = found.some((m) => m.confidence === "medium");

  return {
    hit      : highHit,
    ambiguous: !highHit && medHit,
    matches  : found,
    elapsedMs: performance.now() - t0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// L3 – Semantic Vector Search  (async, delegates to semantic-search.js)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * L3 scan: embed the query and run cosine similarity against the local vector store.
 * @param {string} text
 * @returns {Promise<{ hit: boolean, classification: string, topSimilarity: number, elapsedMs: number }>}
 */
async function l3Scan(text) {
  const t0 = performance.now();
  try {
    const { topClassification, results } = semanticSearch(text, { topK: 3, minScore: 0.15 });
    const topSimilarity = results.length > 0 ? results[0].similarity : 0;
    return {
      hit           : topClassification.secret,
      classification: topClassification.label,
      topSimilarity,
      elapsedMs     : performance.now() - t0,
    };
  } catch {
    // If the vector store is empty or unavailable, treat as clean
    return { hit: false, classification: "CLEAR", topSimilarity: 0, elapsedMs: performance.now() - t0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Triage Result Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   safe          : boolean,
 *   escalated     : boolean,
 *   triggeredLayer: "L1"|"L2"|"L3"|null,
 *   reason        : string,
 *   details       : { l1?: Object, l2?: Object, l3?: Object },
 *   totalMs       : number
 * }} TriageResult
 */

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the full multi-layer triage pipeline on `text`.
 *
 * Escalation logic:
 *  • L1 hit  → unsafe, stop (no need for expensive layers)
 *  • L2 high hit → unsafe, stop
 *  • L2 ambiguous (medium only) → escalate to L3
 *  • L2 clean → escalate to L3 (semantic context may still flag it)
 *  • L3 hit  → unsafe
 *  • All clean → safe
 *
 * @param {string} text
 * @returns {Promise<TriageResult>}
 */
export async function triage(text) {
  const t0 = performance.now();

  if (!text || typeof text !== "string") {
    return { safe: true, escalated: false, triggeredLayer: null, reason: "empty input", details: {}, totalMs: 0 };
  }

  // ── L1 ──────────────────────────────────────────────────────────────────
  const l1 = l1Scan(text);
  if (l1.hit) {
    return {
      safe          : false,
      escalated     : false,
      triggeredLayer: "L1",
      reason        : `Bloom filter hit on: ${l1.matchedWords.slice(0, 5).join(", ")}`,
      details       : { l1 },
      totalMs       : performance.now() - t0,
    };
  }

  // ── L2 ──────────────────────────────────────────────────────────────────
  const l2 = l2Scan(text);
  if (l2.hit) {
    return {
      safe          : false,
      escalated     : false,
      triggeredLayer: "L2",
      reason        : `PII detected: ${l2.matches.map((m) => m.label).join(", ")}`,
      details       : { l1, l2 },
      totalMs       : performance.now() - t0,
    };
  }

  // ── L3 (escalate for ambiguous or clean inputs) ─────────────────────────
  const l3 = await l3Scan(text);
  if (l3.hit) {
    return {
      safe          : false,
      escalated     : true,
      triggeredLayer: "L3",
      reason        : `Semantic classification: ${l3.classification} (similarity ${l3.topSimilarity.toFixed(3)})`,
      details       : { l1, l2, l3 },
      totalMs       : performance.now() - t0,
    };
  }

  return {
    safe          : true,
    escalated     : true,  // L3 was invoked
    triggeredLayer: null,
    reason        : l2.ambiguous ? "Ambiguous – L3 cleared" : "All layers passed",
    details       : { l1, l2, l3 },
    totalMs       : performance.now() - t0,
  };
}

/**
 * Synchronous fast-path: run only L1 + L2 (no semantic search).
 * Use for keystroke-level pre-filtering where async latency is unacceptable.
 *
 * @param {string} text
 * @returns {{ safe: boolean, triggeredLayer: "L1"|"L2"|null, reason: string, totalMs: number }}
 */
export function triageSync(text) {
  const t0 = performance.now();

  if (!text || typeof text !== "string") {
    return { safe: true, triggeredLayer: null, reason: "empty input", totalMs: 0 };
  }

  const l1 = l1Scan(text);
  if (l1.hit) {
    return {
      safe          : false,
      triggeredLayer: "L1",
      reason        : `Bloom filter hit on: ${l1.matchedWords.slice(0, 5).join(", ")}`,
      totalMs       : performance.now() - t0,
    };
  }

  const l2 = l2Scan(text);
  if (l2.hit) {
    return {
      safe          : false,
      triggeredLayer: "L2",
      reason        : `PII detected: ${l2.matches.map((m) => m.label).join(", ")}`,
      totalMs       : performance.now() - t0,
    };
  }

  return { safe: true, triggeredLayer: null, reason: "L1+L2 passed", totalMs: performance.now() - t0 };
}

/**
 * Export Bloom filter internals for diagnostics / admin dashboard.
 */
export function getTriageStats() {
  return {
    bloomFilterSize      : BLOOM_SIZE,
    bloomHashFunctions   : BLOOM_HASH_COUNT,
    sensitiveKeywordCount: SENSITIVE_KEYWORDS.length,
    l2PatternCount       : L2_PATTERNS.length,
  };
}
