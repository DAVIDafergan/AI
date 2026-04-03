/**
 * api-server.js – Local Express API for GhostLayer Browser Extensions
 *
 * Exposes a single endpoint used by employee browser extensions to check
 * whether a text snippet matches sensitive company data in the local vector
 * index.  All processing is local – nothing is forwarded to the cloud.
 *
 * Detection runs in three ordered tiers:
 *   Tier 1 – Regex Layer      : fast pattern matching (credit cards, IDs, emails…)
 *   Tier 2 – Custom Deny-List : admin-defined keywords fetched from the SaaS server
 *   Tier 3 – Vector Semantic  : embedding-based similarity against the local brain
 *
 * Context Awareness: detects sensitive data hidden inside tables (CSV/TSV rows)
 *   or code snippets (indented blocks, code-fence markers).
 *
 * POST /api/check
 *   Body:  { "text": "<snippet from browser>", "userEmail": "<employee email>" }
 *   Reply (clean):     { "action": "allow",  "blocked": false, "reason": string }
 *   Reply (sensitive): { "action": "mask",   "blocked": true,
 *                        "maskedText": string, "vault": Record<string,string>,
 *                        "detectionTier": "regex"|"keyword"|"vector" }
 *   Reply (error):     { "action": "block",  "blocked": true,  "reason": string }
 */

import express from "express";
import cors    from "cors";
import { querySimilarity, loadIndex } from "./vector-store.js";
import { initNLP } from "./nlp-engine.js";
import { sendTenantEvent } from "./cloud-sync.js";

// ── Thresholds ────────────────────────────────────────────────────────────────
const BLOCK_THRESHOLD = 0.82;
const AGENT_VERSION   = "3.1.0";

// Pre-loaded index shared across all requests (refreshed on startup)
let _cachedIndex = null;

// ── Cached NER pipeline (initialised lazily on first sensitive hit) ───────────
let _nerPipelinePromise = null;

// Runtime config set by startApiServer (used for cloud event reporting and
// pulling the custom deny-list from the SaaS server)
let _tenantApiKey = "";
let _serverUrl    = "";

// ── Custom deny-list (fetched from SaaS; refreshed every 5 minutes) ──────────
let _customKeywords      = [];   // [{ word, category, severity }]
let _customKeywordsEtag  = "";   // for HTTP caching
let _lastKeywordFetch    = 0;
const KEYWORD_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

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
    _customKeywords = Array.isArray(data.keywords) ? data.keywords : [];
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
 *
 * @returns {Promise<void>}
 */
export async function warmCache() {
  _cachedIndex = await loadIndex();
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

  // Pre-load the vector index once
  _cachedIndex = await loadIndex();

  if (verbose) {
    console.log(`[api-server] Vector index loaded: ${_cachedIndex.length} document(s)`);
  }

  // Prime the custom deny-list (best-effort)
  await refreshCustomKeywords();

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  // ── Health check ─────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({
      status:        "ok",
      indexedDocs:   _cachedIndex.length,
      customKeywords: _customKeywords.length,
      agentVersion:  AGENT_VERSION,
    });
  });

  // ── Sensitivity check endpoint (3-tier) ──────────────────────────────────
  app.post(["/api/check", "/api/check-text"], async (req, res) => {
    const text      = (req.body?.text      ?? "").trim();
    const userEmail = (req.body?.userEmail ?? "").trim() || "unknown";

    if (!text) {
      return res.status(400).json({ action: "allow", blocked: false, reason: "No text provided." });
    }

    try {
      // Refresh the custom deny-list in the background (non-blocking)
      refreshCustomKeywords().catch(() => {});

      // ── Context detection (table / code) ─────────────────────────────
      const { isTable, isCode } = detectContext(text);

      // ── Tier 1: Regex Layer ──────────────────────────────────────────
      // Fast synchronous check – if any hard pattern matches, block immediately.
      let tier1Match = false;
      for (const { re } of TIER1_PATTERNS) {
        if (new RegExp(re.source, "i").test(text)) { tier1Match = true; break; }
      }

      // ── Tier 2: Custom Deny-List ─────────────────────────────────────
      let tier2Match = false;
      let matchedKeyword = null;
      for (const kw of _customKeywords) {
        if (!kw.word) continue;
        if (new RegExp(escapeRegex(kw.word.trim()), "i").test(text)) {
          tier2Match = true;
          matchedKeyword = kw;
          break;
        }
      }

      // ── Tier 3: Vector Semantic Layer ────────────────────────────────
      let vectorMatches = [];
      if (!tier1Match && !tier2Match) {
        vectorMatches = await querySimilarity(text, {
          topK:      3,
          threshold: BLOCK_THRESHOLD,
          index:     _cachedIndex,
        });
      }

      const isSensitive = tier1Match || tier2Match || vectorMatches.length > 0;

      if (isSensitive) {
        // Determine detection tier for telemetry / logging
        const detectionTier = tier1Match ? "regex"
          : tier2Match ? "keyword"
          : "vector";

        // NER masking (lazy init)
        if (!_nerPipelinePromise) {
          _nerPipelinePromise = initNLP().catch(() => null);
        }
        const ner = await _nerPipelinePromise;

        let nerEntities = [];
        if (ner) {
          try {
            nerEntities = await ner(text, { aggregation_strategy: "simple" });
          } catch {
            // NER failure is non-fatal – fall back to regex-only masking
          }
        }

        const { maskedText, vault } = maskEntities(text, nerEntities, _customKeywords);

        let reason = "Sensitive content detected";
        if (tier1Match)             reason = "Hard-pattern match (Regex Layer).";
        else if (tier2Match)        reason = `Custom deny-list match: "${matchedKeyword?.word}".`;
        else if (vectorMatches.length > 0) {
          const topScore  = (vectorMatches[0].similarity * 100).toFixed(1);
          const topSource = vectorMatches[0].path.split(/[\\/]/).pop();
          reason = `Sensitive company data detected (${topScore}% similarity to "${topSource}").`;
        }

        if (isTable) reason += " [Data detected in table context]";
        if (isCode)  reason += " [Data detected inside code block]";

        if (verbose) {
          console.log(`[api-server] [${detectionTier}] Masking ${Object.keys(vault).length} entity(ies): ${reason}`);
        }

        // Fire-and-forget cloud event (metadata only, no sensitive text)
        if (_tenantApiKey) {
          const topSim = vectorMatches[0]?.similarity ?? (tier1Match ? 1 : 0.9);
          sendTenantEvent({
            tenantApiKey:     _tenantApiKey,
            serverUrl:        _serverUrl,
            userEmail,
            action:           "MASKED",
            sensitivityLevel: scoreToLevel(topSim),
            matchedEntities:  detectEntityTypes(text),
            detectionTier,
            context:          { isTable, isCode },
          }).catch(() => {});
        }

        const result = {
          action: "mask",
          blocked: true,
          reason,
          maskedText,
          vault,
          detectionTier,
          context: { isTable, isCode },
        };
        onCheck?.(result);
        return res.json(result);
      }

      const clean = { action: "allow", blocked: false, reason: "No sensitive content detected." };
      onCheck?.(clean);
      return res.json(clean);

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

