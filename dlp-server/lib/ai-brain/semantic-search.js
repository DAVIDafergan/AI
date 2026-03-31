/**
 * lib/ai-brain/semantic-search.js
 *
 * Semantic DLP Engine – Context-Aware Cosine Similarity Search
 * ─────────────────────────────────────────────────────────────
 * • Embeds an incoming user prompt using the same projection as the ingestion engine
 * • Performs cosine similarity against the local in-memory vector store
 * • Applies a dynamic threshold: similarity > SENSITIVITY_THRESHOLD (0.85) →
 *   context is classified exclusively as "COMPANY_INTERNAL_SECRET"
 * • Returns ranked results with classification labels
 *
 * Zero data leaves the local environment.
 */

import { embedText, getVectorIndex, getIndexStats } from "./ingestion.js";

// ─────────────────────────────────────────────────────────────────────────────
// Thresholds & Classification Labels
// ─────────────────────────────────────────────────────────────────────────────

/** Similarity above this value → exclusively classified as a company secret */
const SENSITIVITY_THRESHOLD = 0.85;

/** Similarity levels for graduated classification */
const THRESHOLDS = {
  COMPANY_INTERNAL_SECRET : 0.85,
  HIGHLY_SENSITIVE        : 0.65,
  SENSITIVE               : 0.40,
  POTENTIALLY_SENSITIVE   : 0.20,
};

/**
 * Classify a numeric similarity score into a human-readable label.
 * @param {number} score
 * @returns {{ label: string, level: number, secret: boolean }}
 */
function classifyScore(score) {
  if (score >= THRESHOLDS.COMPANY_INTERNAL_SECRET) {
    return { label: "COMPANY_INTERNAL_SECRET", level: 4, secret: true };
  }
  if (score >= THRESHOLDS.HIGHLY_SENSITIVE) {
    return { label: "HIGHLY_SENSITIVE",         level: 3, secret: false };
  }
  if (score >= THRESHOLDS.SENSITIVE) {
    return { label: "SENSITIVE",                level: 2, secret: false };
  }
  if (score >= THRESHOLDS.POTENTIALLY_SENSITIVE) {
    return { label: "POTENTIALLY_SENSITIVE",    level: 1, secret: false };
  }
  return { label: "CLEAR",                      level: 0, secret: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cosine Similarity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute cosine similarity between two equal-length dense float arrays.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}  value in [0, 1] (vectors are L2-normalised at embedding time)
 */
function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // Clamp to [0, 1] – small floating-point overshoots can occur
  return Math.min(1, Math.max(0, (dot + 1) / 2)); // shift from [-1,1] to [0,1]
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   id: string,
 *   docId: string,
 *   chunkIndex: number,
 *   text: string,
 *   similarity: number,
 *   classification: { label: string, level: number, secret: boolean },
 *   metadata: Object
 * }} SearchResult
 */

/**
 * Perform a semantic similarity search against the local vector store.
 *
 * @param {string} queryText                   - The raw user prompt / text to evaluate
 * @param {{ topK?: number, minScore?: number, organizationId?: string }} [options]
 * @returns {{ results: SearchResult[], topClassification: { label: string, level: number, secret: boolean }, queryEmbeddingMs: number, searchMs: number }}
 */
export function semanticSearch(queryText, { topK = 5, minScore = 0, organizationId = null } = {}) {
  if (!queryText || typeof queryText !== "string") {
    throw new TypeError("queryText must be a non-empty string");
  }

  // Embed query
  const t0           = Date.now();
  const queryVec     = embedText(queryText);
  const embeddingMs  = Date.now() - t0;

  // Scan index
  const t1    = Date.now();
  const hits  = [];

  for (const entry of getVectorIndex()) {
    // Optional per-organisation filtering
    if (organizationId && entry.metadata?.organizationId !== organizationId) continue;
    if (!entry.embedding) continue;

    const sim = cosineSimilarity(queryVec, entry.embedding);
    if (sim < minScore) continue;

    hits.push({
      id            : entry.id,
      docId         : entry.docId,
      chunkIndex    : entry.chunkIndex,
      text          : entry.text,
      similarity    : parseFloat(sim.toFixed(6)),
      classification: classifyScore(sim),
      metadata      : entry.metadata,
    });
  }

  const searchMs = Date.now() - t1;

  // Sort by similarity descending and cap at topK
  hits.sort((a, b) => b.similarity - a.similarity);
  const results = hits.slice(0, topK);

  // Overall classification = highest individual score
  const topScore    = results.length > 0 ? results[0].similarity : 0;
  const topClass    = classifyScore(topScore);

  return { results, topClassification: topClass, queryEmbeddingMs: embeddingMs, searchMs };
}

/**
 * Quick DLP check: embed prompt and return whether it crosses the sensitivity threshold.
 *
 * @param {string} promptText
 * @returns {{ isSecret: boolean, topSimilarity: number, classification: string, matchedChunk: string|null }}
 */
export function dlpCheck(promptText) {
  const { results } = semanticSearch(promptText, { topK: 1, minScore: 0 });

  if (results.length === 0) {
    return { isSecret: false, topSimilarity: 0, classification: "CLEAR", matchedChunk: null };
  }

  const top = results[0];
  return {
    isSecret       : top.similarity >= SENSITIVITY_THRESHOLD,
    topSimilarity  : top.similarity,
    classification : top.classification.label,
    matchedChunk   : top.text,
    docId          : top.docId,
  };
}

/**
 * Export current index stats for health/monitoring endpoints.
 * @returns {Object}
 */
export function getSemanticEngineStats() {
  return {
    ...getIndexStats(),
    sensitivityThreshold: SENSITIVITY_THRESHOLD,
  };
}
