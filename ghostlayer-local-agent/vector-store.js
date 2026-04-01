/**
 * vector-store.js – Lightweight JSON-based local vector index
 *
 * Uses @xenova/transformers to generate sentence embeddings from document text.
 * All data stays local – the vector index is written to .ghostlayer_vectors.json
 * and is never uploaded to any cloud service.
 *
 * Capabilities:
 *   - ingestDocuments(files) – embed all docs and persist the index
 *   - querySimilarity(text)  – return top-K matches and cosine similarity scores
 */

import { pipeline }           from "@xenova/transformers";
import { writeFile, readFile } from "fs/promises";
import { join }               from "path";

// ── Embedding pipeline (lazy-loaded) ─────────────────────────────────────────

let _embedPipeline = null;

/**
 * Initialise (or return cached) sentence-embedding pipeline.
 * Uses a lightweight quantised model (~23 MB) that runs fully offline once cached.
 *
 * @returns {Promise<Function>}
 */
async function getEmbedder() {
  if (_embedPipeline) return _embedPipeline;
  _embedPipeline = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
    { quantized: true },
  );
  return _embedPipeline;
}

// ── Vector math helpers ───────────────────────────────────────────────────────

/**
 * Compute cosine similarity between two equal-length float arrays.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}  In [-1, 1]; higher means more similar.
 */
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Embed a text string into a flat float array using mean-pooling.
 *
 * @param {string}   text
 * @param {Function} embedder  Transformers.js feature-extraction pipeline.
 * @returns {Promise<number[]>}
 */
async function embedText(text, embedder) {
  // Truncate to ~512 tokens worth of characters to respect model limits
  const truncated = text.slice(0, 2000);
  const output    = await embedder(truncated, { pooling: "mean", normalize: true });
  // output.data is a Float32Array – convert to a plain JS array for JSON storage
  return Array.from(output.data);
}

// ── Vector store I/O ──────────────────────────────────────────────────────────

const VECTOR_INDEX_FILE = join(process.cwd(), ".ghostlayer_vectors.json");

/**
 * @typedef {{ path: string, snippet: string, vector: number[] }} VectorEntry
 */

/**
 * Persist the vector index to disk.
 *
 * @param {VectorEntry[]} entries
 * @returns {Promise<void>}
 */
async function saveIndex(entries) {
  await writeFile(
    VECTOR_INDEX_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2),
    "utf8",
  );
}

/**
 * Load the vector index from disk, or return an empty array if not found.
 *
 * @returns {Promise<VectorEntry[]>}
 */
export async function loadIndex() {
  try {
    const raw  = await readFile(VECTOR_INDEX_FILE, "utf8");
    const data = JSON.parse(raw);
    return data.entries || [];
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Embed all documents and write the vector index to disk.
 * Replaces any previously stored index.
 *
 * @param {Array<{ path: string, content: string }>} files
 * @param {{ verbose?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function ingestDocuments(files, options = {}) {
  const { verbose = false } = options;

  const embedder = await getEmbedder();
  const entries  = [];

  let processed = 0;
  for (const { path: filePath, content } of files) {
    try {
      const vector  = await embedText(content, embedder);
      // Store a short representative snippet for debugging (not transmitted to cloud)
      const snippet = content.slice(0, 200).replace(/\s+/g, " ").trim();
      entries.push({ path: filePath, snippet, vector });
    } catch (err) {
      if (verbose) {
        console.warn(`[vector-store] Skipping ${filePath}: ${err.message}`);
      }
    }

    processed++;
    if (verbose) {
      process.stdout.write(`\r[vector-store] Embedding… ${processed}/${files.length}`);
    }
  }

  if (verbose) console.log();

  await saveIndex(entries);

  if (verbose) {
    console.log(`[vector-store] Index saved: ${entries.length} document(s)`);
  }
}

/**
 * Query the vector index for the most similar documents to `queryText`.
 *
 * @param {string}  queryText  The text snippet to compare against the index.
 * @param {object}  [opts]
 * @param {number}  [opts.topK=5]          Number of top results to return.
 * @param {number}  [opts.threshold=0.75]  Minimum cosine similarity to include.
 * @param {VectorEntry[]} [opts.index]     Pre-loaded index (skips disk I/O).
 * @returns {Promise<Array<{ path: string, similarity: number }>>}
 */
export async function querySimilarity(queryText, opts = {}) {
  const { topK = 5, threshold = 0.75, index: preloaded } = opts;

  const embedder = await getEmbedder();
  const entries  = preloaded ?? (await loadIndex());

  if (entries.length === 0) return [];

  const queryVec = await embedText(queryText, embedder);

  const scored = entries.map((e) => ({
    path:       e.path,
    similarity: cosineSimilarity(queryVec, e.vector),
  }));

  return scored
    .filter((r) => r.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}
