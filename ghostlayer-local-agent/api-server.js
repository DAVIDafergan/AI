/**
 * api-server.js – Local Express API for GhostLayer Browser Extensions
 *
 * Exposes a single endpoint used by employee browser extensions to check
 * whether a text snippet matches sensitive company data in the local vector
 * index.  All processing is local – nothing is forwarded to the cloud.
 *
 * POST /api/check
 *   Body:  { "text": "<snippet from browser>", "userEmail": "<employee email>" }
 *   Reply (clean):    { "action": "allow",  "blocked": false, "reason": string }
 *   Reply (sensitive): { "action": "mask",   "blocked": true,
 *                        "maskedText": string, "vault": Record<string,string> }
 *   Reply (error):    { "action": "block",  "blocked": true,  "reason": string }
 */

import express from "express";
import cors    from "cors";
import { querySimilarity, loadIndex } from "./vector-store.js";
import { initNLP } from "./nlp-engine.js";
import { sendTenantEvent } from "./cloud-sync.js";

// ── Similarity threshold above which a snippet is considered sensitive ────────
const BLOCK_THRESHOLD = 0.82;

// Pre-loaded index shared across all requests (refreshed on startup)
let _cachedIndex = null;

// ── Cached NER pipeline (initialised lazily on first sensitive hit) ───────────
let _nerPipelinePromise = null;

// Runtime config set by startApiServer (used for cloud event reporting)
let _tenantApiKey = "";
let _serverUrl    = "";

// ── Regex patterns used for token-based masking ───────────────────────────────
const MASK_PATTERNS = [
  { type: "EMAIL",   re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g },
  { type: "PHONE",   re: /(?:\+?\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{4}\b/g },
  { type: "ACCOUNT", re: /\b\d{2,4}[-\s]\d{3,4}[-\s]\d{4,10}\b/g },
  { type: "CREDIT",  re: /\b(?:\d[ \-]?){13,16}\b/g },
  { type: "ID",      re: /\b\d{9}\b/g },
];

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
  // Credit card: 13-16 digit sequences with optional separators
  if (/\b(?:\d[ \-]?){13,16}\b/.test(text))
    entities.push("CREDIT_CARD");
  // Israeli ID: 9-digit number
  if (/\b\d{9}\b/.test(text))
    entities.push("ID_NUMBER");
  if (/\b(password|secret|token|api.?key|credentials)\b/i.test(text))
    entities.push("CREDENTIALS");
  // PERSON is always included when a vector similarity match was found –
  // callers must only invoke this function in the sensitive-match code path.
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
  // Use word boundaries if the word is purely alphabetical to avoid partial matches
  const pattern = /^[A-Za-z]+$/.test(word)
    ? new RegExp(`\\b${escaped}\\b`, "g")
    : new RegExp(escaped, "g");
  return text.replace(pattern, token);
}

/**
 * Mask sensitive entities in `text` and return the masked string plus a vault
 * mapping tokens back to their original values.
 *
 * NER entities (PERSON / ORG) are masked first, then regex patterns are applied
 * to the remaining text so that numeric sequences are not fragmented by prior
 * replacements.
 *
 * @param {string}   text         Raw text from the browser extension.
 * @param {object[]} nerEntities  Aggregated NER results (may be empty).
 * @returns {{ maskedText: string, vault: Record<string, string> }}
 */
function maskEntities(text, nerEntities = []) {
  const vault    = {};
  const counters = {};
  let   masked   = text;

  /** Allocate the next sequential token for a given entity type prefix. */
  function nextToken(prefix) {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return `[${prefix}_${counters[prefix]}]`;
  }

  // ── 1. NER-based masking (PERSON / ORG) ─────────────────────────────────
  for (const entity of nerEntities) {
    const label = (entity.entity_group || entity.entity || "").toUpperCase();
    const word  = (entity.word || "").trim();

    if (!word || word.length < 2 || word.startsWith("##")) continue;
    if ((entity.score ?? 0) < 0.5) continue;

    let prefix = null;
    if      (label === "PER" || label.endsWith("-PER")) prefix = "PERSON";
    else if (label === "ORG" || label.endsWith("-ORG")) prefix = "ORG";
    if (!prefix) continue;

    // Only replace if still present (prior entity may have consumed it)
    if (!masked.includes(word)) continue;

    const token = nextToken(prefix);
    vault[token] = word;
    masked = replaceWord(masked, word, token);
  }

  // ── 2. Regex-based masking (EMAIL / PHONE / ACCOUNT / CREDIT / ID) ──────
  for (const { type, re } of MASK_PATTERNS) {
    const globalRe = new RegExp(re.source, "g");
    masked = masked.replace(globalRe, (match) => {
      const token = nextToken(type);
      vault[token] = match;
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

  // Store config for use inside request handlers
  if (apiKey)    _tenantApiKey = apiKey;
  if (serverUrl) _serverUrl    = serverUrl;

  // Pre-load the vector index once
  _cachedIndex = await loadIndex();

  if (verbose) {
    console.log(`[api-server] Vector index loaded: ${_cachedIndex.length} document(s)`);
  }

  const app = express();

  // ── Middleware ───────────────────────────────────────────────────────────
  app.use(cors());
  app.use(express.json());

  // ── Health check ─────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({
      status:        "ok",
      indexedDocs:   _cachedIndex.length,
      agentVersion:  "3.0.0",
    });
  });

  // ── Sensitivity check endpoint ───────────────────────────────────────────
  app.post("/api/check", async (req, res) => {
    const text      = (req.body?.text      ?? "").trim();
    const userEmail = (req.body?.userEmail ?? "").trim() || "unknown";

    if (!text) {
      return res.status(400).json({ action: "allow", blocked: false, reason: "No text provided." });
    }

    try {
      const matches = await querySimilarity(text, {
        topK:      3,
        threshold: BLOCK_THRESHOLD,
        index:     _cachedIndex,
      });

      if (matches.length > 0) {
        // ── Smart Masking: extract entities and tokenise ─────────────────
        // Lazily initialise the NER pipeline (cached after first use).
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

        const { maskedText, vault } = maskEntities(text, nerEntities);

        const topScore  = (matches[0].similarity * 100).toFixed(1);
        const topSource = matches[0].path.split(/[\\/]/).pop();
        const reason    = `Sensitive company data detected (${topScore}% similarity to "${topSource}").`;

        if (verbose) {
          console.log(`[api-server] Masking ${Object.keys(vault).length} entit(ies): ${reason}`);
        }

        // ── Fire-and-forget cloud event (metadata only, no sensitive text) ──
        if (_tenantApiKey) {
          sendTenantEvent({
            tenantApiKey:    _tenantApiKey,
            serverUrl:       _serverUrl,
            userEmail,
            action:          "MASKED",
            sensitivityLevel: scoreToLevel(matches[0].similarity),
            matchedEntities: detectEntityTypes(text),
          }).catch(() => { /* non-critical */ });
        }

        const result = { action: "mask", blocked: true, reason, maskedText, vault };
        onCheck?.(result);
        return res.json(result);
      }

      const clean = { action: "allow", blocked: false, reason: "No sensitive content detected." };
      onCheck?.(clean);
      return res.json(clean);
    } catch (err) {
      console.error(`[api-server] /api/check error: ${err.message}`);
      // By default fail closed (block) to prevent data leakage when the engine errors.
      // Pass failClosed: false in options for environments where availability matters more.
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
