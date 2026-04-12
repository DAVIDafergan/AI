/**
 * vector-store.js – Qdrant-backed vector index for semantic document search
 *
 * Uses @xenova/transformers to generate sentence embeddings from document text,
 * then upserts them into a local Qdrant instance for durable, scalable storage.
 * All data stays local – embeddings are stored in Qdrant (never uploaded to any
 * cloud service) and are queried for semantic similarity at detection time.
 *
 * Configuration:
 *   QDRANT_URL – Qdrant REST API base URL (default: http://localhost:6333)
 *
 * Capabilities:
 *   - ingestDocuments(files) – embed all docs and upsert into Qdrant
 *   - querySimilarity(text)  – return top-K matches and cosine similarity scores
 *   - loadIndex()            – no-op compatibility shim (returns empty array)
 *
 * Qdrant collection schema:
 *   Name    : ghostlayer_documents
 *   Vectors : 384-dim (all-MiniLM-L6-v2), Cosine distance
 *   Payload : { path: string, snippet: string }
 */

import { pipeline }           from "@xenova/transformers";
import { QdrantClient }       from "@qdrant/js-client-rest";

// ── Constants ─────────────────────────────────────────────────────────────────

const COLLECTION_NAME = "ghostlayer_documents";
const VECTOR_DIM      = 384; // all-MiniLM-L6-v2 output dimension

// ── Qdrant client (lazy-initialised) ─────────────────────────────────────────

/** @type {QdrantClient | null} */
let _qdrantClient = null;

function getQdrantClient() {
  if (_qdrantClient) return _qdrantClient;
  const url = process.env.QDRANT_URL || "http://localhost:6333";
  _qdrantClient = new QdrantClient({ url });
  return _qdrantClient;
}

/**
 * Ensure the Qdrant collection exists with the expected vector configuration.
 * Creates it if missing; leaves it untouched if it already exists.
 */
async function ensureCollection() {
  const client = getQdrantClient();
  try {
    await client.getCollection(COLLECTION_NAME);
  } catch {
    // Collection does not exist – create it.
    await client.createCollection(COLLECTION_NAME, {
      vectors: { size: VECTOR_DIM, distance: "Cosine" },
    });
  }
}

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
  // output.data is a Float32Array – convert to a plain JS array
  return Array.from(output.data);
}

/**
 * Derive a deterministic integer ID from a file path for stable Qdrant upserts.
 * Uses a 32-bit FNV-1a hash to minimise collisions.
 *
 * @param {string} filePath
 * @returns {number}  Non-negative 32-bit integer.
 */
function pathToId(filePath) {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < filePath.length; i++) {
    hash ^= filePath.charCodeAt(i);
    hash  = (Math.imul(hash, 0x01000193) >>> 0); // FNV prime, keep unsigned
  }
  return hash;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compatibility shim: callers that pre-load the index with loadIndex() and pass
 * it as opts.index to querySimilarity() will now get an empty array, which
 * querySimilarity ignores in favour of a live Qdrant query.
 *
 * @returns {Promise<[]>}
 */
export async function loadIndex() {
  return [];
}

/**
 * Embed all documents and upsert them into Qdrant.
 * Documents with the same path are overwritten (deterministic ID from path).
 *
 * @param {Array<{ path: string, content: string }>} files
 * @param {{ verbose?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function ingestDocuments(files, options = {}) {
  const { verbose = false } = options;

  await ensureCollection();

  const embedder = await getEmbedder();
  const client   = getQdrantClient();

  // Batch upserts to avoid oversized single requests (100 points per batch)
  const BATCH_SIZE = 100;
  let processed = 0;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch  = files.slice(i, i + BATCH_SIZE);
    const points = [];

    for (const { path: filePath, content } of batch) {
      try {
        const vector  = await embedText(content, embedder);
        const snippet = content.slice(0, 200).replace(/\s+/g, " ").trim();
        points.push({
          id:      pathToId(filePath),
          vector,
          payload: { path: filePath, snippet },
        });
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

    if (points.length > 0) {
      await client.upsert(COLLECTION_NAME, { points });
    }
  }

  if (verbose) {
    console.log();
    console.log(`[vector-store] Qdrant index updated: ${processed} document(s)`);
  }
}

/**
 * Query Qdrant for the most similar documents to `queryText`.
 *
 * @param {string}  queryText  The text snippet to compare against the index.
 * @param {object}  [opts]
 * @param {number}  [opts.topK=5]          Number of top results to return.
 * @param {number}  [opts.threshold=0.75]  Minimum cosine similarity to include.
 * @param {any[]}   [opts.index]           Ignored – Qdrant manages the index.
 * @returns {Promise<Array<{ path: string, similarity: number }>>}
 */
export async function querySimilarity(queryText, opts = {}) {
  const { topK = 5, threshold = 0.75 } = opts;

  const embedder  = await getEmbedder();
  const queryVec  = await embedText(queryText, embedder);

  let results;
  try {
    results = await getQdrantClient().search(COLLECTION_NAME, {
      vector:          queryVec,
      limit:           topK,
      score_threshold: threshold,
      with_payload:    true,
    });
  } catch (err) {
    // Qdrant unavailable (e.g. collection empty or service down) – return no matches.
    if (err.message?.includes("Not found")) return [];
    throw err;
  }

  return results.map((r) => ({
    path:       r.payload?.path ?? String(r.id),
    similarity: r.score,
  }));
}

