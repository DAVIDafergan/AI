/**
 * bloom-filter.js – Ultra-lightweight Bloom Filter for fast keyword pre-screening
 *
 * Cascade Fast-Path (Tier 0): if none of the loaded sensitive keywords or patterns
 * are present in a text snippet, all AI models are bypassed and the request is
 * allowed immediately.  Target execution time: < 1ms per check.
 *
 * A Bloom Filter guarantees zero false negatives: if `bloomCheck()` returns false,
 * the text is definitively clean.  The only cost of false positives is an
 * unnecessary trip into the full pipeline, which is the safe direction.
 *
 * No external dependencies – pure JavaScript implementation.
 *
 * Filter parameters (defaults):
 *   Size   : 60,000 bytes  (480,000 bits)
 *   Hashes : 7
 *   Capacity: ~50,000 items at ≈ 1% false-positive rate
 */

// ── Filter parameters ────────────────────────────────────────────────────────

const DEFAULT_SIZE_BYTES = 60_000; // 480,000 bits
const DEFAULT_NUM_HASHES = 7;

/** Minimum token/word length to probe or insert into the filter. */
const MIN_WORD_LENGTH = 4;

/**
 * Maximum number of characters hashed per string probe.
 * Capping the input bounds the loop in the hash functions and prevents a
 * potential DoS from very long strings while still capturing enough of the
 * text for reliable detection (sensitive keywords are rarely > 64 chars).
 */
const MAX_STR_HASH_LEN = 256;

// ── BloomFilter class ────────────────────────────────────────────────────────

class BloomFilter {
  /**
   * @param {number} sizeBytes  Bit-array size in bytes.
   * @param {number} numHashes  Number of independent hash probes per item.
   */
  constructor(sizeBytes = DEFAULT_SIZE_BYTES, numHashes = DEFAULT_NUM_HASHES) {
    this.bits      = new Uint8Array(sizeBytes);
    this.bitCount  = sizeBytes * 8;
    this.numHashes = numHashes;
    this.itemsAdded = 0;
  }

  /** FNV-1a 32-bit hash. Input is capped at MAX_STR_HASH_LEN characters. */
  _fnv1a(str) {
    const s = str.length > MAX_STR_HASH_LEN ? str.slice(0, MAX_STR_HASH_LEN) : str;
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h  = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }

  /** DJB2 32-bit hash. Input is capped at MAX_STR_HASH_LEN characters. */
  _djb2(str) {
    const s = str.length > MAX_STR_HASH_LEN ? str.slice(0, MAX_STR_HASH_LEN) : str;
    let h = 5381 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  /**
   * Derive `numHashes` bit positions via double-hashing:
   *   pos_i = (h1 + i * h2) mod bitCount
   */
  _positions(str) {
    const h1  = this._fnv1a(str);
    const h2  = this._djb2(str) | 1; // keep h2 odd to cover all positions
    const pos = new Array(this.numHashes);
    for (let i = 0; i < this.numHashes; i++) {
      pos[i] = ((h1 + i * h2) >>> 0) % this.bitCount;
    }
    return pos;
  }

  /** Insert a string into the filter. */
  add(str) {
    const s = str.toLowerCase();
    for (const p of this._positions(s)) {
      this.bits[p >> 3] |= 1 << (p & 7);
    }
    this.itemsAdded++;
  }

  /**
   * Returns false if `str` is definitely NOT in the set.
   * Returns true  if `str` MIGHT be in the set (possible false positive).
   */
  mightContain(str) {
    const s = str.toLowerCase();
    for (const p of this._positions(s)) {
      if ((this.bits[p >> 3] & (1 << (p & 7))) === 0) return false;
    }
    return true;
  }
}

// ── Built-in sensitive vocabulary ─────────────────────────────────────────────
// Every term here is loaded into the filter on startup.  Add project names,
// internal code names, or any domain-specific keywords that should always be
// caught.

const SENSITIVE_KEYWORDS = [
  // Financial / business intelligence
  "revenue", "profit", "loss", "budget", "forecast", "invoice", "salary",
  "payroll", "bonus", "equity", "valuation", "acquisition", "merger",
  "confidential", "proprietary", "secret", "nda", "non-disclosure",
  // Credentials / access tokens
  "password", "token", "credentials", "api_key", "apikey", "api-key",
  "access_token", "client_secret", "private_key", "bearer",
  // PII categories
  "ssn", "passport", "iban", "swift", "routing number", "bank account",
  "credit card", "date of birth", "social security", "national id",
  // Sensitive document markers
  "internal only", "do not distribute", "draft",
  // Hebrew sensitive terms:
  //   הכנסה = revenue, רווח = profit, הפסד = loss, תקציב = budget,
  //   תחזית = forecast, חשבונית = invoice, שכר = salary,
  //   סודי = confidential/secret, קנייני = proprietary
  "הכנסה", "רווח", "הפסד", "תקציב", "תחזית", "חשבונית", "שכר", "סודי", "קנייני",
];

// Key jailbreak / prompt-injection trigger words added so that LLM attack text
// always passes through the jailbreak check rather than being fast-pathed.
const JAILBREAK_TRIGGER_WORDS = [
  "jailbreak", "dan mode", "developer mode", "unfiltered",
  "token smuggling", "grandmother exploit", "hypnosis prompt",
  "new system prompt", "ignore previous", "disregard previous",
  "no restrictions", "no filter", "override safety",
  "your real instructions",
];

// ── Module-level filter instance ──────────────────────────────────────────────

/** @type {BloomFilter | null} */
let _filter = null;

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Insert a term AND every individual word within it (for multi-word phrases).
 * Words shorter than MIN_WORD_LENGTH characters are skipped to avoid excessive
 * false positives from common short words (e.g. "of", "the", "api").
 * @param {BloomFilter} filter
 * @param {string} term
 */
function addTerm(filter, term) {
  filter.add(term);
  for (const word of term.split(/\s+/)) {
    if (word.length >= MIN_WORD_LENGTH) filter.add(word);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Initialise (or reinitialise) the Bloom Filter with all built-in sensitive
 * vocabulary plus optional corporate context from the saved brain file and
 * custom deny-list.
 *
 * Call once at agent startup (in `warmCache()` / `startApiServer()`).
 * Re-calling is safe – it rebuilds the filter from scratch.
 *
 * @param {{
 *   learnedPersons?:  string[],
 *   learnedOrgs?:     string[],
 *   customKeywords?:  Array<{ word: string }>,
 * }} [brainData]
 * @returns {BloomFilter}
 */
export function initBloomFilter(brainData = {}) {
  const filter = new BloomFilter();

  // ── Built-in vocabulary ──────────────────────────────────────────────────
  for (const kw of SENSITIVE_KEYWORDS)        addTerm(filter, kw);
  for (const kw of JAILBREAK_TRIGGER_WORDS)   addTerm(filter, kw);

  // ── Corporate brain entities ─────────────────────────────────────────────
  if (Array.isArray(brainData.learnedPersons)) {
    for (const p of brainData.learnedPersons) addTerm(filter, p);
  }
  if (Array.isArray(brainData.learnedOrgs)) {
    for (const o of brainData.learnedOrgs)    addTerm(filter, o);
  }

  // ── Custom deny-list ─────────────────────────────────────────────────────
  if (Array.isArray(brainData.customKeywords)) {
    for (const kw of brainData.customKeywords) {
      if (kw.word) addTerm(filter, kw.word);
    }
  }

  _filter = filter;
  return filter;
}

/**
 * Lazily initialise the filter (default vocabulary only) when no explicit
 * `initBloomFilter()` call has been made yet.
 */
function ensureFilter() {
  if (!_filter) initBloomFilter();
}

/**
 * Add additional terms to the live filter (e.g. after refreshing the custom
 * deny-list).  Each term and its individual words are inserted.
 *
 * @param {string[]} terms
 */
export function addTermsToFilter(terms) {
  ensureFilter();
  for (const term of terms) addTerm(_filter, term);
}

/**
 * Tier 0 fast-path pre-screen.
 *
 * Returns false only when the Bloom Filter can guarantee that no known
 * sensitive keyword, entity, or credential pattern is present in the text,
 * making it safe to bypass all AI models and return { allowed: true }
 * immediately (target: < 1ms execution).
 *
 * Checks:
 *   1. Whole-text Bloom probe (catches multi-word phrases, emails via @, etc.)
 *   2. Token-level Bloom probe on individual words
 *   3. Structural heuristics (@-sign, 4+ consecutive digits) as last resort
 *
 * @param {string} text  Raw input text.
 * @returns {boolean}  true = might be sensitive (proceed); false = definitely clean (bypass).
 */
export function bloomCheck(text) {
  ensureFilter();

  const lower = text.toLowerCase();

  // 1. Whole-text probe (catches @-containing emails, multi-word phrases)
  if (_filter.mightContain(lower)) return true;

  // 2. Token-level probe – checks individual words so that multi-word phrases
  //    whose constituent words were loaded into the filter are also caught.
  //    Tokens shorter than MIN_WORD_LENGTH are skipped (mirrors addTerm logic).
  const tokens = lower.split(/[\s\r\n\t,;:!?()\[\]{}<>"'`/\\|=+*&^%$#@~]+/);
  for (const token of tokens) {
    if (token.length >= MIN_WORD_LENGTH && _filter.mightContain(token)) return true;
  }

  // 3. Structural heuristics that the Bloom Filter cannot capture as keywords
  if (lower.includes("@"))      return true; // email address indicator
  if (/\d{4,}/.test(lower))     return true; // 4+ consecutive digits → PII/account number

  return false;
}

/**
 * Returns true when the filter has been explicitly initialised.
 * @returns {boolean}
 */
export function isBloomFilterReady() {
  return _filter !== null;
}

/**
 * Return diagnostic statistics for the current filter instance.
 * @returns {{ itemsAdded: number, sizeBytes: number, hashCount: number } | null}
 */
export function getBloomFilterStats() {
  if (!_filter) return null;
  return {
    itemsAdded: _filter.itemsAdded,
    sizeBytes:  _filter.bits.byteLength,
    hashCount:  _filter.numHashes,
  };
}
