/**
 * api-server.js – Local Express API for GhostLayer Browser Extensions
 *
 * Exposes a single endpoint used by employee browser extensions to check
 * whether a text snippet matches sensitive company data in the local vector
 * index.  All processing is local – nothing is forwarded to the cloud.
 *
 * POST /api/check
 *   Body:  { "text": "<snippet from browser>", "userEmail": "<employee email>" }
 *   Reply: { "blocked": boolean, "reason": string }
 */

import express from "express";
import cors    from "cors";
import { querySimilarity, loadIndex } from "./vector-store.js";
import { sendTenantEvent } from "./cloud-sync.js";

// ── Similarity threshold above which a snippet is considered sensitive ────────
const BLOCK_THRESHOLD = 0.82;

// Pre-loaded index shared across all requests (refreshed on startup)
let _cachedIndex = null;

// Runtime config set by startApiServer (used for cloud event reporting)
let _tenantApiKey = "";
let _serverUrl    = "";

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
  // Credit card: 13-16 digit sequences with optional separators (same pattern as nlp-engine)
  if (/\b(?:\d[ \-]?){13,16}\b/.test(text))
    entities.push("BANK_ACCOUNT");
  // Israeli ID: 9-digit number (same pattern as nlp-engine)
  if (/\b\d{9}\b/.test(text))
    entities.push("ID_NUMBER");
  if (/\b(password|secret|token|api.?key|credentials)\b/i.test(text))
    entities.push("CREDENTIALS");
  // PERSON is added when there's a vector similarity match against the indexed corpus
  // (caller is responsible for only invoking this function when a match was found)
  entities.push("PERSON");
  return [...new Set(entities)];
}

/**
 * Map a similarity score (0–1) to a human-readable sensitivity level.
 *
 * @param {number} score
 * @returns {"low" | "medium" | "high" | "critical"}
 */
function scoresToLevel(score) {
  if (score >= 0.95) return "critical";
  if (score >= 0.90) return "high";
  if (score >= 0.85) return "medium";
  return "low";
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
 *   onCheck?: (result: { blocked: boolean, reason: string }) => void,
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
      return res.status(400).json({ blocked: false, reason: "No text provided." });
    }

    try {
      const matches = await querySimilarity(text, {
        topK:      3,
        threshold: BLOCK_THRESHOLD,
        index:     _cachedIndex,
      });

      if (matches.length > 0) {
        const topScore  = (matches[0].similarity * 100).toFixed(1);
        const topSource = matches[0].path.split(/[\\/]/).pop(); // basename only

        // ── Fire-and-forget cloud event (metadata only, no sensitive text) ──
        if (_tenantApiKey) {
          sendTenantEvent({
            tenantApiKey:    _tenantApiKey,
            serverUrl:       _serverUrl,
            userEmail,
            action:          "BLOCKED",
            sensitivityLevel: scoresToLevel(matches[0].similarity),
            matchedEntities: detectEntityTypes(text),
          }).catch(() => { /* non-critical */ });
        }

        if (onCheck) onCheck({ blocked: true, reason: `Similarity to "${topSource}"` });

        return res.json({
          blocked: true,
          reason:  `Sensitive company data detected (${topScore}% similarity to "${topSource}").`,
        });
      }

      if (onCheck) onCheck({ blocked: false, reason: "No sensitive content detected." });
      return res.json({ blocked: false, reason: "No sensitive content detected." });
    } catch (err) {
      console.error(`[api-server] /api/check error: ${err.message}`);
      // By default fail closed (block) to prevent data leakage when the engine errors.
      // Pass failClosed: false in options for environments where availability matters more.
      if (onCheck) onCheck({ blocked: failClosed, reason: "Check engine error" });
      return res.status(500).json({
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
