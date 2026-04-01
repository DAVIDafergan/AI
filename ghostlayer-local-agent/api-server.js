/**
 * api-server.js – Local Express API for GhostLayer Browser Extensions
 *
 * Exposes a single endpoint used by employee browser extensions to check
 * whether a text snippet matches sensitive company data in the local vector
 * index.  All processing is local – nothing is forwarded to the cloud.
 *
 * POST /api/check
 *   Body:  { "text": "<snippet from browser>" }
 *   Reply: { "blocked": boolean, "reason": string }
 */

import express from "express";
import cors    from "cors";
import { querySimilarity, loadIndex } from "./vector-store.js";

// ── Similarity threshold above which a snippet is considered sensitive ────────
const BLOCK_THRESHOLD = 0.82;

// Pre-loaded index shared across all requests (refreshed on startup)
let _cachedIndex = null;

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
 *   onCheck?: (result: { blocked: boolean, reason: string }) => void,
 * }} [options]
 * @returns {Promise<import("http").Server>}
 */
export async function startApiServer(options = {}) {
  const { port = 4000, verbose = false, failClosed = true, onCheck } = options;

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
    const text = (req.body?.text ?? "").trim();

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
        return res.json({
          blocked: true,
          reason:  `Sensitive company data detected (${topScore}% similarity to "${topSource}").`,
        });
      }

      return res.json({ blocked: false, reason: "No sensitive content detected." });
    } catch (err) {
      console.error(`[api-server] /api/check error: ${err.message}`);
      // By default fail closed (block) to prevent data leakage when the engine errors.
      // Pass failClosed: false in options for environments where availability matters more.
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
