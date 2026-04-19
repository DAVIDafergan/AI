/**
 * api-server.js – Local Express API for GhostLayer Browser Extensions
 *
 * Exposes endpoints used by employee browser extensions to check whether a
 * text snippet or image contains sensitive company data.
 * All processing is local – nothing is forwarded to the cloud.
 *
 * Detection runs in the following ordered tiers (Cascade Fast-Path):
 *   Tier 0   – Bloom Filter Fast-Path : keyword pre-screen, < 1ms bypass
 *   Tier 0.5 – Semantic Cache (Redis) : return cached decision on repeat payloads
 *   Tier 1   – Evasion Normalisation  : strip obfuscation before any check
 *   Tier 1.5 – LLM Security           : prompt-injection & jailbreak detection
 *   Tier 2   – Regex Layer            : fast PII pattern matching
 *   Tier 2.5 – AST Code Analysis      : detect business logic in pasted code (Acorn)
 *   Tier 2.6 – Intent Classification  : zero-shot NLI model detects leakage intent
 *   Tier 3   – Custom Deny-List       : admin-defined keywords
 *   Tier 4   – Vector Semantic        : embedding-based similarity
 *   Tier 5   – Fragment Memory        : detect split-data attacks across pastes
 *   Tier 6   – Behavior Analytics     : anomaly / user-risk scoring (dynamic threshold)
 *
 * POST /api/check
 *   Body:  { "text": string, "userEmail": string }
 *
 * POST /api/check-image
 *   Body:  { "imageData": "<base64 data-URI>", "userEmail": string }
 *   Extracts text with Tesseract OCR and runs the normal detection pipeline.
 *
 * GET /api/behavior-profiles
 *   Returns all user behavioral profiles (admin endpoint, requires x-api-key).
 */

import express        from "express";
import cors           from "cors";
import multer         from "multer";
import { querySimilarity, loadIndex } from "./vector-store.js";
import { initNLP, loadBrain } from "./nlp-engine.js";
import { sendTenantEvent } from "./cloud-sync.js";
import { normalizeForDetection, hasEvasionSignals } from "./evasion-detector.js";
import {
  recordFragment,
  peekFragmentWindow,
  getFragmentCount,
  clearFragments,
  updateUserProfile,
  getAllProfiles,
} from "./fragment-cache.js";
import { classifyIntent, HIGH_RISK_INTENTS, initIntentClassifier } from "./intent-classifier.js";
import { analyzeCodeAst, summarizeAstFindings } from "./ast-analyzer.js";
import { initSpooler, updateSpoolerConfig } from "./offline-spooler.js";
import { initBloomFilter, bloomCheck, addTermsToFilter, isBloomFilterReady, getBloomFilterStats } from "./bloom-filter.js";
import { getCachedResult, setCachedResult } from "./semantic-cache.js";

// ── Thresholds ────────────────────────────────────────────────────────────────
const BLOCK_THRESHOLD = 0.82;
const AGENT_VERSION   = "3.3.0";

// Pre-loaded index shared across all requests (refreshed on startup)
let _cachedIndex = null;

// ── Cached NER pipeline (initialised lazily on first sensitive hit) ───────────
let _nerPipelinePromise = null;

// Runtime config set by startApiServer (used for cloud event reporting and
// pulling the custom deny-list from the SaaS server)
let _tenantApiKey = "";
let _serverUrl    = "";

// ── Brain PII context (loaded from .ghostlayer_brain.json) ──────────────────
// Populated by loadBrainPii() at startup and refreshed after each indexing run.
// Used by isPiiConfirmedSensitive() for context-aware Tier 1 detection so that
// PHONE / CREDIT / ID patterns only block when the value was actually found in
// indexed company documents.
let _brainPhoneSet   = new Set();
let _brainCreditSet  = new Set();
let _brainIdSet      = new Set();
let _brainPersonsSet = new Set();
let _brainOrgsSet    = new Set();
let _hasBrainData    = false;

// ── Custom deny-list (fetched from SaaS; refreshed every 5 minutes) ──────────
let _customKeywords      = [];   // [{ word, category, severity }]
let _customKeywordsEtag  = "";   // for HTTP caching
let _lastKeywordFetch    = 0;
const KEYWORD_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Load PII values and entity sets from the persisted brain file into memory.
 * Silently no-ops when the brain file does not yet exist (first run).
 * Called at startup (warmCache / startApiServer) and after each re-index.
 */
async function loadBrainPii() {
  try {
    const brain = await loadBrain();
    if (!brain?.learnedIndex) return;
    const idx = brain.learnedIndex;
    _brainPhoneSet   = new Set((idx.learnedPhones      ?? []).filter(Boolean));
    _brainCreditSet  = new Set((idx.learnedCreditCards  ?? []).filter(Boolean));
    _brainIdSet      = new Set((idx.learnedIds          ?? []).filter(Boolean));
    _brainPersonsSet = new Set((idx.learnedPersons      ?? []).map((p) => p.toLowerCase()));
    _brainOrgsSet    = new Set((idx.learnedOrgs         ?? []).map((o) => o.toLowerCase()));
    _hasBrainData    = _brainPhoneSet.size > 0 || _brainCreditSet.size > 0 ||
                       _brainIdSet.size > 0    || _brainPersonsSet.size > 0 ||
                       _brainOrgsSet.size > 0;
  } catch {
    // Brain file not yet available – context-aware checks will be skipped
  }
}

/**
 * Strip all non-digit characters from a value (used to normalise phone /
 * credit-card / ID strings for Set lookup).
 * @param {string} value
 * @returns {string}
 */
function normalizePiiDigits(value) {
  return value.replace(/\D/g, "");
}

/**
 * Determine whether a Tier 1 regex match is confirmed as sensitive by the
 * corporate AI brain context.
 *
 * Decision rules:
 *   • EMAIL, PASSWORD, SSN → always sensitive (hard block, no brain needed).
 *   • PHONE, CREDIT, ID, ACCOUNT with an empty brain → NOT sensitive; the text
 *     falls through to the semantic/vector tier instead of being blocked blindly.
 *   • PHONE, CREDIT, ID, ACCOUNT with a built brain → sensitive only when:
 *       a) the digits-normalised value was extracted from a company document, OR
 *       b) the surrounding text mentions a known corporate person or org —
 *          indicating the PII appears alongside a real company entity.
 *
 * This ensures employees are never blocked for typing their own phone number,
 * a personal credit card, or a random ID, while still catching exfiltration of
 * data that is verifiably in the corporate corpus.
 *
 * @param {string} value   The raw matched value from the regex.
 * @param {string} type    One of the TIER1_PATTERNS types.
 * @param {string} text    The full text being scanned (for entity context).
 * @returns {boolean}
 */
function isPiiConfirmedSensitive(value, type, text) {
  // Always-sensitive: credential / identity patterns – no context check needed
  if (type === "EMAIL" || type === "PASSWORD" || type === "SSN") return true;

  // Without a built brain we cannot confirm corporate context → allow
  if (!_hasBrainData) return false;

  const digits = normalizePiiDigits(value);

  // (a) Exact match against known PII values from indexed company documents
  if ((type === "PHONE" || type === "ACCOUNT") && _brainPhoneSet.has(digits)) return true;
  if (type === "CREDIT" && _brainCreditSet.has(digits)) return true;
  if (type === "ID"     && _brainIdSet.has(digits))     return true;

  // (b) A known corporate person or org appears in the same text
  const lower = text.toLowerCase();
  for (const person of _brainPersonsSet) {
    if (person.length >= 3 && lower.includes(person)) return true;
  }
  for (const org of _brainOrgsSet) {
    if (org.length >= 3 && lower.includes(org)) return true;
  }

  return false;
}

/**
 * Fetch (or refresh) the org's custom deny-list from the SaaS server.
 * Errors are non-fatal – we continue with the stale list.
 */
async function refreshCustomKeywords() {
  if (!_tenantApiKey || !_serverUrl) return;
  const now = Date.now();
  if (now - _lastKeywordFetch < KEYWORD_REFRESH_MS) return;
  _lastKeywordFetch = now;

  try {
    const url  = `${_serverUrl.replace(/\/$/, "")}/api/custom-keywords`;
    const resp = await fetch(url, {
      headers: {
        "x-api-key": _tenantApiKey,
        ...(  _customKeywordsEtag ? { "If-None-Match": _customKeywordsEtag } : {} ),
      },
      signal: AbortSignal.timeout(5000),
    });

    if (resp.status === 304) return; // Not modified
    if (!resp.ok) return;

    const etag = resp.headers.get("etag") || "";
    if (etag) _customKeywordsEtag = etag;

    const data = await resp.json();
    const newKeywords = Array.isArray(data.keywords) ? data.keywords : [];

    // Push any newly-fetched keywords into the live Bloom Filter so the
    // fast-path knows about them without requiring a full restart.
    // Use a Set for O(n) lookups rather than repeated Array.some() scans.
    const existingWords = new Set(_customKeywords.map((kw) => kw.word));
    const added = newKeywords.filter((kw) => kw.word && !existingWords.has(kw.word));
    if (added.length > 0) {
      addTermsToFilter(added.map((kw) => kw.word));
    }

    _customKeywords = newKeywords;
  } catch {
    // Non-critical – keep using the existing list
  }
}

// ── Regex patterns for Tier 1 hard pattern matching ──────────────────────────
// Ordered from most-specific to least-specific to avoid false positives.
const TIER1_PATTERNS = [
  { type: "CREDIT",   re: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g },
  { type: "EMAIL",    re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g },
  { type: "PHONE",    re: /(?:\+?\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{4}\b/g },
  { type: "ID",       re: /\b\d{9}\b/g },
  { type: "ACCOUNT",  re: /\b\d{2,4}[-\s]\d{3,4}[-\s]\d{4,10}\b/g },
  { type: "PASSWORD", re: /\b(password|secret|token|api[_\-]?key)\s*[:=]\s*\S+/gi },
  { type: "SSN",      re: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g },
];

// ── Mask patterns (superset – also used for post-NER regex masking) ───────────
const MASK_PATTERNS = TIER1_PATTERNS;

// ── LLM Security: Prompt Injection & Jailbreak Signatures ────────────────────
// Tier 0.5 – runs before all other tiers on the raw (pre-normalised) input AND
// on the normalised form.  A match here fires an LLM_JAILBREAK_ATTEMPT event
// with Critical severity and unconditionally blocks the prompt.

/** Phrases that indicate a prompt-injection attempt. */
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|earlier|above|preceding)\s+(instructions?|prompt|context|rules?|constraints?|guidelines?)/i,
  /disregard\s+(all\s+)?(previous|prior|earlier|above|system)\s+(instructions?|prompt|context|rules?)/i,
  /forget\s+(everything|all)\s+(you|i)\s+(were|was|have\s+been)\s+(told|given|instructed)/i,
  /you\s+are\s+now\s+(a|an|the)\s+(?!assistant|helpful)[a-z ]{2,40}(?:bot|ai|model|llm|system)/i,
  /\bnew\s+system\s+prompt\b/i,
  /\boverride\s+(?:your\s+)?(?:safety|content|ethical?|alignment)\s+(?:filter|rule|policy|guideline|restriction)/i,
  /\byour\s+real\s+instructions?\s+are\b/i,
  /\bpretend\s+(?:that\s+)?you\s+(?:have\s+no|don'?t\s+have\s+any|are\s+not\s+bound\s+by)/i,
  /act\s+as\s+if\s+you\s+(?:have\s+no|were\s+not)\s+(?:restriction|filter|rule|ethic|align)/i,
];

/** Phrases that indicate a jailbreak attempt (DAN, persona-based, etc.). */
const JAILBREAK_PATTERNS = [
  /\bDAN\b.*(?:mode|jailbreak|unlock|bypass)/i,
  /\bdo\s+anything\s+now\b/i,
  /jailbreak(?:ed|ing)?\s+(?:mode|prompt|version)/i,
  /\bdeveloper\s+mode\b.*(?:enabled|unlocked|activated|on)/i,
  /\bunfiltered\s+(?:mode|version|ai|response)\b/i,
  /\bno\s+(?:restrictions?|limits?|rules?|filters?|censorship|ethics?|morals?|guardrails?)\b/i,
  /\byou\s+(?:must|should|will|shall)\s+(?:comply|obey|follow|answer)\s+(?:without|regardless)/i,
  /\bstay\s+in\s+character\b.*(?:no\s+matter|regardless|always|at\s+all\s+times)/i,
  /\btoken\s+smuggling\b/i,
  /\bsimulated\s+(?:reality|world|universe)\s+where\s+(?:there\s+are\s+)?no\s+rules/i,
  /\byour\s+training\s+(?:data|constraints?|rules?)\s+(?:don'?t|do\s+not)\s+apply/i,
  /grandmother\s+exploit/i,
  /\bhypnosis\s+prompt\b/i,
];

/**
 * Check text for LLM prompt-injection and jailbreak attack patterns.
 *
 * @param {string} raw       Raw (pre-normalisation) text.
 * @param {string} normalized Post-normalisation text.
 * @returns {{
 *   isLlmAttack: boolean,
 *   attackType: "PROMPT_INJECTION" | "LLM_JAILBREAK" | null,
 *   matchedPattern: string | null,
 * }}
 */
function detectLlmAttack(raw, normalized) {
  const targets = [raw, normalized];

  for (const text of targets) {
    for (const re of PROMPT_INJECTION_PATTERNS) {
      if (re.test(text)) {
        return { isLlmAttack: true, attackType: "PROMPT_INJECTION", matchedPattern: re.source };
      }
    }
    for (const re of JAILBREAK_PATTERNS) {
      if (re.test(text)) {
        return { isLlmAttack: true, attackType: "LLM_JAILBREAK", matchedPattern: re.source };
      }
    }
  }

  return { isLlmAttack: false, attackType: null, matchedPattern: null };
}

// ── Context-aware patterns: detect sensitive data inside tables / code ────────
const CONTEXT_PATTERNS = [
  // CSV / TSV rows that contain an email or ID
  { context: "table", re: /([^\n,\t]+[,\t][^\n,\t]+){2,}/g },
  // Code fences that may hide credentials
  { context: "code",  re: /```[\s\S]*?```|`[^`]+`/g },
  // Markdown/text tables
  { context: "table", re: /\|[^|\n]+\|[^|\n]+\|/g },
];

/**
 * Detect whether the text contains data hidden inside a table or code block
 * that overlaps with a Tier-1 pattern match.
 *
 * @param {string} text
 * @returns {{ isTable: boolean, isCode: boolean }}
 */
function detectContext(text) {
  let isTable = false;
  let isCode  = false;

  for (const { context, re } of CONTEXT_PATTERNS) {
    const matches = text.match(new RegExp(re.source, "g"));
    if (!matches) continue;

    for (const m of matches) {
      // Only flag if the contextual block itself contains a sensitive pattern
      const hasSensitive = TIER1_PATTERNS.some((p) =>
        new RegExp(p.re.source).test(m)
      );
      if (hasSensitive) {
        if (context === "table") isTable = true;
        if (context === "code")  isCode  = true;
      }
    }
  }

  return { isTable, isCode };
}

/**
 * Detect entity types present in the given text using lightweight regex checks.
 * Used for cloud telemetry metadata ONLY – no raw text is ever sent to the cloud.
 * Returns entity type labels (never the actual matched values).
 *
 * @param {string} text
 * @returns {string[]}
 */
function detectEntityTypes(text) {
  const entities = [];
  if (/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/.test(text))
    entities.push("EMAIL");
  if (/(?:\+?\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{4}\b/.test(text))
    entities.push("PHONE");
  if (/\b(?:\d[ \-]?){13,16}\b/.test(text))
    entities.push("CREDIT_CARD");
  if (/\b\d{9}\b/.test(text))
    entities.push("ID_NUMBER");
  if (/\b(password|secret|token|api.?key|credentials)\b/i.test(text))
    entities.push("CREDENTIALS");
  entities.push("PERSON");
  return [...new Set(entities)];
}

/**
 * Map a similarity score (0–1) to a human-readable sensitivity level.
 *
 * @param {number} score
 * @returns {"low" | "medium" | "high" | "critical"}
 */
function scoreToLevel(score) {
  if (score >= 0.95) return "critical";
  if (score >= 0.90) return "high";
  if (score >= 0.85) return "medium";
  return "low";
}

/**
 * Escape a string for safe use inside a RegExp.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace every occurrence of `word` in `text` with `token`.
 * Replacement is word-boundary aware when the word starts/ends with a letter.
 * @param {string} text
 * @param {string} word
 * @param {string} token
 * @returns {string}
 */
function replaceWord(text, word, token) {
  const escaped = escapeRegex(word);
  const pattern = /^[A-Za-z]+$/.test(word)
    ? new RegExp(`\\b${escaped}\\b`, "g")
    : new RegExp(escaped, "g");
  return text.replace(pattern, token);
}

/**
 * Merge consecutive NER entities of the same entity type that are separated
 * only by whitespace in the original text into a single combined entity.
 *
 * When a NER model emits "John" (PER) and "Smith" (PER) as two adjacent
 * predictions, this function joins them into the single entity "John Smith",
 * preserving the semantic connection between name parts.
 *
 * @param {object[]} entities  Raw NER output (should include start/end offsets).
 * @param {string}   text      The original text passed to the NER model.
 * @returns {object[]}
 */
function mergeAdjacentNerEntities(entities, text) {
  if (!entities || entities.length === 0) return entities;

  const merged = [];
  let   cursor = null;

  for (const entity of entities) {
    const label = (entity.entity_group || entity.entity || "").toUpperCase();

    if (!cursor) {
      cursor = { ...entity, _label: label };
      continue;
    }

    const sameType   = label === cursor._label;
    const hasOffsets = entity.start != null && cursor.end != null;
    // Also require that the next entity starts at or after where the current one
    // ends, so that overlapping or out-of-order NER output is never merged.
    const adjacent   = hasOffsets &&
                       entity.start >= cursor.end &&
                       /^\s*$/.test(text.slice(cursor.end, entity.start));

    if (sameType && adjacent) {
      // Extend the current entity to include this adjacent one.
      // Prefer slicing the original text (which preserves exact spacing) when
      // character offsets are available; fall back to a single-space join.
      const mergedWord = hasOffsets
        ? text.slice(cursor.start, entity.end)
        : `${cursor.word} ${entity.word.trim()}`;
      cursor = {
        ...cursor,
        word:  mergedWord,
        end:   entity.end,
        score: Math.min(cursor.score ?? 1, entity.score ?? 1),
      };
    } else {
      merged.push(cursor);
      cursor = { ...entity, _label: label };
    }
  }

  if (cursor) merged.push(cursor);
  return merged;
}

/**
 * Mask sensitive entities in `text` and return the masked string plus a vault
 * mapping tokens back to their original values.
 *
 * Each unique original value is assigned exactly one token — subsequent
 * occurrences of the same value reuse the same token rather than receiving an
 * incrementing number.  Adjacent NER entities of the same type (e.g. a first
 * name followed by a last name) are merged into a single entity before masking
 * so that "John" + "Smith" are treated as one person, not two.
 *
 * Masking order:
 *   1. NER entities (PERSON / ORG) – highest specificity
 *   2. Tier-1 regex patterns (EMAIL, PHONE, CREDIT, ID…)
 *   3. Custom deny-list keywords
 *
 * @param {string}   text
 * @param {object[]} nerEntities   Aggregated NER results (may be empty).
 * @param {object[]} [customKws]   Custom deny-list entries [{ word, category }]
 * @returns {{ maskedText: string, vault: Record<string, string> }}
 */
function maskEntities(text, nerEntities = [], customKws = []) {
  const vault         = {};
  const counters      = {};
  const valueToToken  = {}; // reverse lookup: original value → assigned token
  let   masked        = text;

  function nextToken(prefix) {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return `[${prefix}_${counters[prefix]}]`;
  }

  // Return the existing token for a value, or allocate a new one.
  function tokenFor(prefix, value) {
    if (valueToToken[value]) return valueToToken[value];
    const token = nextToken(prefix);
    vault[token]        = value;
    valueToToken[value] = token;
    return token;
  }

  // ── 1. NER-based masking (PERSON / ORG) ─────────────────────────────────
  // Merge adjacent same-type entities first so that "John" + "Smith" (both PER)
  // are handled as the single entity "John Smith".
  const mergedEntities = mergeAdjacentNerEntities(nerEntities, text);

  for (const entity of mergedEntities) {
    const label = (entity.entity_group || entity.entity || "").toUpperCase();
    const word  = (entity.word || "").trim();

    if (!word || word.length < 2 || word.startsWith("##")) continue;
    if ((entity.score ?? 0) < 0.5) continue;

    let prefix = null;
    if      (label === "PER" || label.endsWith("-PER")) prefix = "PERSON";
    else if (label === "ORG" || label.endsWith("-ORG")) prefix = "ORG";
    if (!prefix) continue;

    if (!masked.includes(word)) continue;

    const token = tokenFor(prefix, word);
    masked = replaceWord(masked, word, token);
  }

  // ── 2. Tier-1 regex masking (EMAIL / PHONE / ACCOUNT / CREDIT / ID…) ────
  for (const { type, re } of MASK_PATTERNS) {
    // Recreate with only the global flag; avoid adding flags not in the original pattern.
    const globalRe = new RegExp(re.source, "g");
    masked = masked.replace(globalRe, (match) => tokenFor(type, match));
  }

  // ── 3. Custom deny-list keyword masking ──────────────────────────────────
  for (const kw of customKws) {
    if (!kw.word || kw.word.trim().length < 2) continue;
    const re       = new RegExp(escapeRegex(kw.word.trim()), "gi");
    const category = kw.category || "CUSTOM";
    // All occurrences of the same keyword share a single token; the token is
    // created on the first match and reused for subsequent matches.
    let token = null;
    masked = masked.replace(re, (match) => {
      if (!token) token = tokenFor(category, match);
      return token;
    });
  }

  return { maskedText: masked, vault };
}

/**
 * Warm the in-memory index cache so the first request is not slow.
 * Also pre-loads the intent classifier model in the background and
 * initialises the Bloom Filter with the saved corporate brain context.
 *
 * @returns {Promise<void>}
 */
export async function warmCache() {
  _cachedIndex = await loadIndex();

  // Initialise the Bloom Filter with brain entities persisted from the last
  // indexing run so the fast-path knows about corporate persons / orgs before
  // the background re-index completes.
  try {
    const brain = await loadBrain();
    const brainData = brain
      ? {
          learnedPersons: brain.learnedIndex?.learnedPersons ?? [],
          learnedOrgs:    brain.learnedIndex?.learnedOrgs    ?? [],
        }
      : {};
    initBloomFilter(brainData);
  } catch {
    // Brain file not yet available – initialise with built-in vocabulary only.
    initBloomFilter();
  }

  // Load brain PII data for context-aware Tier 1 detection
  await loadBrainPii();

  // Pre-warm the intent classifier in the background (non-blocking)
  initIntentClassifier().catch(() => {});
}

/**
 * Reload brain PII and entity data from the persisted brain file.
 * Call this after the background indexing pipeline saves a new brain so the
 * live API server immediately uses the updated corporate data for detection.
 *
 * @returns {Promise<void>}
 */
export async function refreshBrain() {
  await loadBrainPii();
  // Refresh Bloom Filter with updated brain entities
  try {
    const brain = await loadBrain();
    const brainData = brain
      ? {
          learnedPersons: brain.learnedIndex?.learnedPersons ?? [],
          learnedOrgs:    brain.learnedIndex?.learnedOrgs    ?? [],
        }
      : {};
    initBloomFilter(brainData);
  } catch {
    // Non-fatal – keep using the existing Bloom Filter state
  }
}

// ── Shared detection pipeline ─────────────────────────────────────────────────
// Extracted so it can be called from both POST /api/check and POST /api/check-image.

/**
 * Run all detection tiers on `text` for `userEmail`.
 *
 * @param {{
 *   text: string,
 *   userEmail: string,
 *   source?: string,
 *   verbose?: boolean,
 *   failClosed?: boolean,
 *   skipFragment?: boolean,
 * }} opts
 * @returns {Promise<object>}  The JSON response object.
 */
async function runDetectionPipeline({ text, userEmail, source = "paste", verbose = false, failClosed = true, skipFragment = false }) {
  // Refresh the custom deny-list in the background (non-blocking)
  refreshCustomKeywords().catch(() => {});

  // ── Tier 0: Bloom Filter Fast-Path (target < 1ms) ────────────────────────
  // If the Bloom Filter reports that no known sensitive keyword, entity, or
  // structural PII signal is present, bypass ALL AI models immediately.
  // The Bloom Filter has zero false negatives: a miss guarantees clean text.
  if (!bloomCheck(text)) {
    if (verbose) {
      console.log("[api-server] Tier 0 Bloom Filter: fast-path clean – pipeline bypassed.");
    }
    return {
      action:        "allow",
      allowed:       true,
      blocked:       false,
      reason:        "No sensitive content detected.",
      detectionTier: "bloom_filter",
      fastPath:      true,
    };
  }

  // ── Tier 0.5: Semantic Cache (Redis) ──────────────────────────────────────
  // If this exact payload (or a structurally identical one) was analysed
  // within the last hour, return the cached decision without running any
  // AI models.
  const cachedResult = await getCachedResult(text);
  if (cachedResult) {
    if (verbose) {
      console.log(`[api-server] Tier 0.5 Semantic Cache: cache hit (${text.length} chars) – returning cached decision.`);
    }
    return cachedResult;
  }

  // ── Tier 1: Evasion Normalisation ────────────────────────────────────────
  // Normalise obfuscated text (homoglyphs, zero-width chars, base64, etc.)
  // before running any detection so evasion attempts are caught.
  const {
    normalized,
    evasionTechniques,
    hasRoleplayInjection,
    extractedFragments,
  } = normalizeForDetection(text);

  // ── Tier 0.5: LLM Security – Prompt Injection & Jailbreak Detection ──────
  // Runs on both the raw text and normalised form before any other tier so that
  // obfuscated jailbreak attempts (e.g. homoglyph-encoded "DAN mode") are caught.
  const llmAttack = detectLlmAttack(text, normalized);
  if (llmAttack.isLlmAttack) {
    if (verbose) {
      console.log(`[api-server] LLM attack detected: ${llmAttack.attackType} – pattern: ${llmAttack.matchedPattern}`);
    }
    // Fire a Critical cloud event (metadata only – no raw text)
    if (_tenantApiKey) {
      sendTenantEvent({
        tenantApiKey:     _tenantApiKey,
        serverUrl:        _serverUrl,
        userEmail,
        action:           "BLOCKED",
        sensitivityLevel: "critical",
        matchedEntities:  [],
        detectionTier:    "llm_security",
        evasionTechniques,
        context:          { source, attackType: llmAttack.attackType },
        eventType:        "LLM_JAILBREAK_ATTEMPT",
      }).catch(() => {});
    }
    return {
      action:        "block",
      blocked:       true,
      eventType:     "LLM_JAILBREAK_ATTEMPT",
      severity:      "critical",
      reason:        `LLM ${llmAttack.attackType === "PROMPT_INJECTION" ? "Prompt Injection" : "Jailbreak"} attempt detected.`,
      detectionTier: "llm_security",
      evasionTechniques,
    };
  }

  // Build a list of texts to scan: normalised original + any extracted fragments
  const scanTargets = [normalized, ...extractedFragments];

  // ── Behavior Analytics (Tier 5 – early, non-blocking) ────────────────────
  const behaviorResult = await updateUserProfile(userEmail, text, evasionTechniques);

  // ── Dynamic threshold: lower block threshold for high-risk users ──────────
  // When the UEBA engine has flagged this user with anomalous behaviour,
  // we tighten the semantic-similarity threshold so even borderline content
  // is blocked (raises effective sensitivity to near 99%).
  const effectiveThreshold = behaviorResult.requiresMFA
    ? Math.min(BLOCK_THRESHOLD, 0.60)
    : BLOCK_THRESHOLD;

  // ── Tier 4: Fragment Memory ───────────────────────────────────────────────
  // Record this paste in the user's 5-minute window and get the combined text.
  let fragmentWindowText = "";
  let fragmentCount = 0;
  if (!skipFragment) {
    fragmentWindowText = await recordFragment(userEmail, normalized, source);
    fragmentCount      = await getFragmentCount(userEmail);
    // Also add the combined window to scan targets (for split-data detection)
    if (fragmentCount > 1) {
      scanTargets.push(fragmentWindowText);
    }
  }

  // ── Context detection (table / code) ──────────────────────────────────────
  const { isTable, isCode } = detectContext(normalized);

  // ── Tier 1.5: AST Code Analysis ─────────────────────────────────────────
  // Parse pasted code to detect business logic / DB calls even when no explicit
  // sensitive keyword is present.  Runs synchronously (Acorn is pure CPU).
  const astResult  = analyzeCodeAst(normalized);
  const astBlocked = !astResult.parseError &&
    (astResult.hasBusinessLogic || astResult.hasDbCalls || astResult.hasCredentialAccess);

  // ── Tier 1.6: Intent Classification ──────────────────────────────────────
  // Run zero-shot classification in parallel with other tiers; block if the
  // model detects a high-risk leakage intent with sufficient confidence.
  const intentResultPromise = classifyIntent(normalized);

  // ── Run pattern matching across all scan targets ──────────────────────────
  let tier1Match = false;
  let tier2Match = false;
  let matchedKeyword = null;
  let vectorMatches  = [];
  let detectedFromFragment = false;

  for (const scanText of scanTargets) {
    // Tier 1: Context-aware Regex Layer
    // EMAIL, PASSWORD, SSN → hard blocks regardless of brain context.
    // PHONE, CREDIT, ID, ACCOUNT → only block when confirmed by the AI brain:
    //   (a) the exact digits-normalised value was extracted from company docs, OR
    //   (b) the text mentions a known corporate person/org alongside the PII value.
    // When no brain has been built yet, these types fall through to the vector tier.
    if (!tier1Match) {
      for (const { type, re } of TIER1_PATTERNS) {
        if (!new RegExp(re.source, "i").test(scanText)) continue;
        const globalRe = new RegExp(re.source, "gi");
        let m;
        while ((m = globalRe.exec(scanText)) !== null) {
          if (isPiiConfirmedSensitive(m[0], type, scanText)) {
            tier1Match = true;
            if (scanText === fragmentWindowText && fragmentCount > 1) detectedFromFragment = true;
            break;
          }
        }
        if (tier1Match) break;
      }
    }

    // Tier 2: Custom deny-list
    if (!tier2Match) {
      for (const kw of _customKeywords) {
        if (!kw.word) continue;
        if (new RegExp(escapeRegex(kw.word.trim()), "i").test(scanText)) {
          tier2Match = true;
          matchedKeyword = kw;
          if (scanText === fragmentWindowText && fragmentCount > 1) detectedFromFragment = true;
          break;
        }
      }
    }
  }

  // Tier 3: Vector Semantic Layer (only on normalised original – vectors are expensive)
  if (!tier1Match && !tier2Match) {
    try {
      vectorMatches = await querySimilarity(normalized, {
        topK:      3,
        threshold: effectiveThreshold,
        index:     _cachedIndex,
      });
    } catch {
      // Vector store (Qdrant) unavailable or not yet populated – treat as no matches
      // and continue with the remaining detection tiers.
      vectorMatches = [];
    }
  }

  // Await intent classification result (started above in parallel)
  const intentResult = await intentResultPromise;

  // Roleplay injection always triggers a block
  const isSensitive = tier1Match || tier2Match || vectorMatches.length > 0 ||
    hasRoleplayInjection || astBlocked || intentResult.isHighRisk;

  // Behavioral anomaly blocks (high-risk users need MFA before continuing)
  const behaviorBlock = behaviorResult.requiresMFA && !isSensitive;

  if (isSensitive || behaviorBlock) {
    const detectionTier = hasRoleplayInjection            ? "roleplay"
      : evasionTechniques.length > 0                      ? `evasion+${tier1Match ? "regex" : tier2Match ? "keyword" : "vector"}`
      : tier1Match                                        ? "regex"
      : tier2Match                                        ? "keyword"
      : behaviorBlock                                     ? "behavior"
      : astBlocked                                        ? "ast"
      : intentResult.isHighRisk                           ? "intent"
      : "vector";

    // NER masking (lazy init)
    if (!_nerPipelinePromise) {
      _nerPipelinePromise = initNLP().catch(() => null);
    }
    const ner = await _nerPipelinePromise;

    let nerEntities = [];
    if (ner && !behaviorBlock) {
      try {
        nerEntities = await ner(normalized, { aggregation_strategy: "simple" });
      } catch {
        // NER failure is non-fatal
      }
    }

    const { maskedText, vault } = maskEntities(normalized, nerEntities, _customKeywords);

    let reason = "Sensitive content detected";
    if (hasRoleplayInjection)        reason = "Prompt injection / roleplay evasion attempt detected.";
    else if (evasionTechniques.length > 0) {
      reason = `Evasion technique(s) detected: ${evasionTechniques.join(", ")}. `;
      if (tier1Match)       reason += "Sensitive pattern found in normalised text.";
      else if (tier2Match)  reason += `Custom deny-list match: "${matchedKeyword?.word}".`;
      else if (vectorMatches.length > 0) {
        const topScore = (vectorMatches[0].similarity * 100).toFixed(1);
        reason += `Semantic match (${topScore}%).`;
      }
    } else if (detectedFromFragment) {
      reason = `Fragmentation attack detected: combined data triggered a match across ${fragmentCount} paste(s).`;
    } else if (tier1Match)      reason = "Hard-pattern match (Regex Layer).";
    else if (tier2Match)        reason = `Custom deny-list match: "${matchedKeyword?.word}".`;
    else if (behaviorBlock)     reason = `Behavioral anomaly: ${behaviorResult.anomalyFlags.join(", ")}. Additional verification required.`;
    else if (astBlocked) {
      const summary = summarizeAstFindings(astResult);
      reason = `Proprietary code / business logic detected (AST analysis). ${summary}`;
    } else if (intentResult.isHighRisk) {
      reason = `Intent classified as "${intentResult.topIntent}" (confidence: ${(intentResult.score * 100).toFixed(0)}%). Potential data-leakage attempt.`;
    } else if (vectorMatches.length > 0) {
      const topScore  = (vectorMatches[0].similarity * 100).toFixed(1);
      const topSource = vectorMatches[0].path.split(/[\\/]/).pop();
      reason = `Sensitive company data detected (${topScore}% similarity to "${topSource}").`;
    }

    if (isTable) reason += " [Data detected in table context]";
    if (isCode)  reason += " [Data detected inside code block]";

    if (verbose) {
      console.log(`[api-server] [${detectionTier}] Masking ${Object.keys(vault).length} entity(ies): ${reason}`);
      if (evasionTechniques.length > 0) {
        console.log(`[api-server] Evasion techniques: ${evasionTechniques.join(", ")}`);
      }
      if (intentResult.topIntent !== "GENERAL") {
        console.log(`[api-server] Intent: ${intentResult.topIntent} (${(intentResult.score * 100).toFixed(0)}%)`);
      }
      if (astBlocked) {
        console.log(`[api-server] AST findings: ${summarizeAstFindings(astResult)}`);
      }
    }

    // Clear fragment cache after a block to prevent re-assembly
    if (detectedFromFragment) await clearFragments(userEmail);

    // Fire-and-forget cloud event (metadata only, no sensitive text)
    if (_tenantApiKey) {
      const topSim = vectorMatches[0]?.similarity ?? (tier1Match ? 1 : astBlocked ? 0.95 : intentResult.isHighRisk ? intentResult.score : 0.9);
      sendTenantEvent({
        tenantApiKey:      _tenantApiKey,
        serverUrl:         _serverUrl,
        userEmail,
        action:            behaviorBlock ? "BEHAVIOR_BLOCK" : "MASKED",
        sensitivityLevel:  scoreToLevel(topSim),
        matchedEntities:   detectEntityTypes(normalized),
        detectionTier,
        evasionTechniques,
        behaviorRiskScore: behaviorResult.riskScore,
        anomalyFlags:      behaviorResult.anomalyFlags,
        context:           { isTable, isCode, source },
        intent:            intentResult.topIntent !== "GENERAL" ? intentResult.topIntent : undefined,
        astFindings:       astBlocked ? {
          hasBusinessLogic:    astResult.hasBusinessLogic,
          hasDbCalls:          astResult.hasDbCalls,
          hasCredentialAccess: astResult.hasCredentialAccess,
        } : undefined,
      }).catch(() => {});
    }

    const blockResult = {
      action:            behaviorBlock ? "block" : "mask",
      blocked:           true,
      reason,
      maskedText:        behaviorBlock ? undefined : maskedText,
      vault:             behaviorBlock ? undefined : vault,
      detectionTier,
      evasionTechniques,
      behaviorRisk:      behaviorResult,
      requiresMFA:       behaviorResult.requiresMFA,
      context:           { isTable, isCode, source },
      intent:            intentResult,
      astAnalysis:       astBlocked ? {
        hasBusinessLogic:       astResult.hasBusinessLogic,
        hasDbCalls:             astResult.hasDbCalls,
        hasCredentialAccess:    astResult.hasCredentialAccess,
        businessLogicFunctions: astResult.businessLogicFunctions,
      } : undefined,
    };

    // Cache the blocking decision (vault is excluded by setCachedResult).
    // Behaviour-based blocks are per-user and must not be cached globally.
    if (!behaviorBlock) {
      setCachedResult(text, blockResult).catch(() => {});
    }

    return blockResult;
  }

  const allowResult = {
    action:            "allow",
    blocked:           false,
    reason:            "No sensitive content detected.",
    evasionTechniques,
    behaviorRisk:      behaviorResult,
    intent:            intentResult,
  };

  // Cache the full-pipeline allow result so repeated clean payloads skip the
  // heavy tiers (vector search, intent classifier) on subsequent requests.
  setCachedResult(text, allowResult).catch(() => {});

  return allowResult;
}

/**
 * Start the local HTTP server that browser extensions call.
 *
 * @param {{
 *   port?: number,
 *   verbose?: boolean,
 *   failClosed?: boolean,
 *   apiKey?: string,
 *   serverUrl?: string,
 *   onCheck?: (result: { action: string, blocked: boolean, reason?: string }) => void,
 * }} [options]
 * @returns {Promise<import("http").Server>}
 */
export async function startApiServer(options = {}) {
  const { port = 4000, verbose = false, failClosed = true, apiKey, serverUrl, onCheck } = options;

  if (apiKey)    _tenantApiKey = apiKey;
  if (serverUrl) _serverUrl    = serverUrl;

  // Initialise the offline spooler so events are never lost during downtime
  initSpooler({ tenantApiKey: _tenantApiKey, serverUrl: _serverUrl, verbose });

  // Pre-load the vector index once
  _cachedIndex = await loadIndex();

  // Load brain PII for context-aware Tier 1 detection
  await loadBrainPii();

  if (verbose) {
    console.log(`[api-server] Vector index loaded: ${_cachedIndex.length} document(s)`);
  }

  // Prime the custom deny-list (best-effort); new keywords are added to the
  // Bloom Filter inside refreshCustomKeywords().
  await refreshCustomKeywords();

  // Ensure the Bloom Filter is initialised even when startApiServer() is called
  // directly without a preceding warmCache() (e.g. in tests or dry-run mode).
  if (!isBloomFilterReady()) {
    initBloomFilter({ customKeywords: _customKeywords });
  }

  if (verbose) {
    const stats = getBloomFilterStats();
    if (stats) {
      console.log(`[api-server] Bloom Filter ready: ${stats.itemsAdded} term(s) loaded, ${stats.sizeBytes} bytes.`);
    }
  }

  // Multer instance for /api/check-file (memory storage – no temp files on disk)
  const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
    fileFilter(_req, file, cb) {
      // Only accept image MIME types for OCR scanning
      if (file.mimetype.startsWith("image/")) {
        cb(null, true);
      } else {
        cb(new Error("Only image files are accepted by /api/check-file"));
      }
    },
  });

  const app = express();

  app.use(cors());
  app.options("/{*corsPreflight}", cors());
  app.use(express.json({ limit: "500kb" }));

  // ── Health check ─────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({
      status:          "ok",
      indexedDocs:     _cachedIndex.length,
      customKeywords:  _customKeywords.length,
      agentVersion:    AGENT_VERSION,
      bloomFilter:     getBloomFilterStats(),
      brainReady:      _hasBrainData,
    });
  });

  // ── Admin: behavioral profiles ────────────────────────────────────────────
  app.get("/api/behavior-profiles", async (req, res) => {
    // Require the tenant API key so only the local admin can access this
    const key = req.headers["x-api-key"] || "";
    if (_tenantApiKey && key !== _tenantApiKey) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return res.json({ profiles: await getAllProfiles() });
  });

  // ── File upload OCR check endpoint (multipart/form-data) ────────────────
  // Accepts an image file via multipart upload, extracts text with OCR, and
  // runs the full DLP detection pipeline.  Designed for drag-and-drop and
  // <input type="file"> upload interception from the browser extension.
  //
  //  POST /api/check-file
  //    Content-Type: multipart/form-data
  //    Fields:
  //      file      (required)  The image file to scan.
  //      userEmail (optional)  Employee email for telemetry.
  app.post("/api/check-file", upload.single("file"), async (req, res) => {
    const userEmail = ((req.body?.userEmail ?? req.query?.userEmail) || "").trim() || "unknown";

    if (!req.file) {
      return res.status(400).json({ action: "allow", blocked: false, reason: "No file uploaded." });
    }

    try {
      // Lazy-load Tesseract.js only when needed
      let tesseract;
      try {
        tesseract = await import("tesseract.js");
      } catch {
        return res.status(503).json({
          action:  "allow",
          blocked: false,
          reason:  "OCR engine not available. Install tesseract.js to enable image scanning.",
        });
      }

      let ocrText = "";
      try {
        const { data } = await tesseract.recognize(req.file.buffer, "eng+heb", {
          logger: () => {},
        });
        ocrText = data?.text ?? "";
      } catch (ocrErr) {
        if (verbose) console.warn(`[api-server] OCR failed (check-file): ${ocrErr.message}`);
        return res.json({ action: "allow", blocked: false, reason: "OCR extraction failed – file allowed." });
      }

      if (!ocrText.trim()) {
        return res.json({ action: "allow", blocked: false, reason: "No text found in uploaded image." });
      }

      if (verbose) {
        console.log(`[api-server] /api/check-file OCR extracted ${ocrText.length} chars for ${userEmail} (${req.file.originalname})`);
      }

      const checkResult = await runDetectionPipeline({
        text: ocrText, userEmail, verbose, failClosed,
        source: "file_upload",
        skipFragment: true,
      });

      if (checkResult.blocked) {
        checkResult.reason = `[OCR File] ${checkResult.reason}`;
        if (!checkResult.detectionTier?.startsWith("llm_security")) {
          checkResult.detectionTier = `ocr+${checkResult.detectionTier}`;
        }
      }

      onCheck?.(checkResult);
      return res.json(checkResult);

    } catch (err) {
      if (err.message?.includes("Only image files")) {
        return res.status(415).json({ action: "block", blocked: failClosed, reason: err.message });
      }
      console.error(`[api-server] /api/check-file error: ${err.message}`);
      return res.status(500).json({
        action:  "block",
        blocked: failClosed,
        reason:  "File check engine error – blocked for safety.",
      });
    }
  });

  // ── Image OCR check endpoint (base64 data-URI) ───────────────────────────
  // Accepts a base64 data-URI image, runs OCR, and checks the extracted text.
  app.post("/api/check-image", async (req, res) => {
    const imageData = (req.body?.imageData ?? "").trim();
    const userEmail = (req.body?.userEmail ?? "").trim() || "unknown";

    if (!imageData) {
      return res.status(400).json({ action: "allow", blocked: false, reason: "No image data provided." });
    }

    try {
      // Lazy-load Tesseract.js only when needed to keep startup fast
      let tesseract;
      try {
        tesseract = await import("tesseract.js");
      } catch {
        return res.status(503).json({
          action: "allow",
          blocked: false,
          reason: "OCR engine not available. Install tesseract.js to enable image scanning.",
        });
      }

      // Strip data-URI prefix: "data:image/png;base64,<data>"
      const base64 = imageData.replace(/^data:image\/[a-z]+;base64,/i, "");
      const buffer = Buffer.from(base64, "base64");

      let ocrText = "";
      try {
        const { data } = await tesseract.recognize(buffer, "eng+heb", {
          logger: () => {},  // suppress verbose progress logs
        });
        ocrText = data?.text ?? "";
      } catch (ocrErr) {
        if (verbose) console.warn(`[api-server] OCR failed: ${ocrErr.message}`);
        return res.json({ action: "allow", blocked: false, reason: "OCR extraction failed – image allowed." });
      }

      if (!ocrText.trim()) {
        return res.json({ action: "allow", blocked: false, reason: "No text found in image." });
      }

      if (verbose) {
        console.log(`[api-server] OCR extracted ${ocrText.length} chars from image for ${userEmail}`);
      }

      // Re-use the same check logic by forwarding internally
      req.body = { text: ocrText, userEmail, source: "image" };
      // Fall through to the same detection pipeline by calling a shared helper
      const checkResult = await runDetectionPipeline({
        text: ocrText, userEmail, verbose, failClosed,
        skipFragment: true,  // images don't contribute to fragment cache
      });

      if (checkResult.blocked) {
        checkResult.reason = `[OCR] ${checkResult.reason}`;
        checkResult.detectionTier = `ocr+${checkResult.detectionTier}`;
      }

      onCheck?.(checkResult);
      return res.json(checkResult);

    } catch (err) {
      console.error(`[api-server] /api/check-image error: ${err.message}`);
      return res.status(500).json({
        action:  "block",
        blocked: failClosed,
        reason:  "Image check engine error – blocked for safety.",
      });
    }
  });

  // ── Context-aware PII check endpoint ─────────────────────────────────────
  // Lightweight alternative to /api/check that only queries the brain context
  // without running the full detection pipeline (no vector search, no NER, no
  // fragment memory).  Used by browser extensions to ask: "is this specific
  // value something the company has flagged as sensitive?"
  //
  //  POST /api/check-context
  //    Body:  { "text": string, "userEmail": string }
  //  Response: {
  //    isSensitive: boolean,
  //    confirmedTypes: string[],
  //    hasBrainEntity: boolean,
  //    brainReady: boolean,
  //    reason: string,
  //  }
  app.post("/api/check-context", async (req, res) => {
    const text      = (req.body?.text      ?? "").trim();
    const userEmail = (req.body?.userEmail ?? "").trim() || "unknown"; // eslint-disable-line no-unused-vars

    if (!text) {
      return res.status(400).json({ isSensitive: false, reason: "No text provided." });
    }

    try {
      const confirmedTypes = [];
      for (const { type, re } of TIER1_PATTERNS) {
        const globalRe = new RegExp(re.source, "gi");
        let m;
        while ((m = globalRe.exec(text)) !== null) {
          if (isPiiConfirmedSensitive(m[0], type, text)) {
            if (!confirmedTypes.includes(type)) confirmedTypes.push(type);
            break;
          }
        }
      }

      const lower = text.toLowerCase();
      const hasBrainEntity =
        [..._brainPersonsSet].some((p) => p.length >= 3 && lower.includes(p)) ||
        [..._brainOrgsSet].some((o) => o.length >= 3 && lower.includes(o));

      const isSensitive = confirmedTypes.length > 0;

      return res.json({
        isSensitive,
        confirmedTypes,
        hasBrainEntity,
        brainReady: _hasBrainData,
        reason: isSensitive
          ? `Confirmed company-sensitive data: ${confirmedTypes.join(", ")}`
          : "No confirmed company-sensitive data found.",
      });
    } catch (err) {
      console.error(`[api-server] /api/check-context error: ${err.message}`);
      return res.status(500).json({ isSensitive: false, reason: "Context check error." });
    }
  });

  // ── Sensitivity check endpoint (multi-tier with evasion detection) ─────────
  app.post(["/api/check", "/api/check-text"], async (req, res) => {
    const text      = (req.body?.text      ?? "").trim();
    const userEmail = (req.body?.userEmail ?? "").trim() || "unknown";
    const source    = (req.body?.source    ?? "paste");

    if (!text) {
      return res.status(400).json({ action: "allow", blocked: false, reason: "No text provided." });
    }

    try {
      const result = await runDetectionPipeline({ text, userEmail, source, verbose, failClosed });
      onCheck?.(result);
      return res.json(result);
    } catch (err) {
      console.error(`[api-server] /api/check error: ${err.message}`);
      return res.status(500).json({
        action:  "block",
        blocked: failClosed,
        reason:  "Check engine error – action blocked for safety.",
      });
    }
  });

  // ── Start listening ──────────────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "0.0.0.0", () => {
      if (verbose) {
        console.log(`[api-server] Listening on http://0.0.0.0:${port}`);
      }
      resolve(server);
    });
    server.on("error", reject);
  });
}
