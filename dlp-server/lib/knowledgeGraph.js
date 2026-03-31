// ── Knowledge Graph – מנוע דמיון וקטורי על בסיס TF-IDF ──
// ללא תלויות חיצוניות (pure JS)
// תומך בטקסט עברי ואנגלי

import { randomUUID } from "crypto";

// ─────────────────────────────────────────────
// TF-IDF Embedding
// ─────────────────────────────────────────────

/**
 * Tokenize text into lowercase tokens (Hebrew + ASCII words).
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[\s,.–:;!?\"'()\[\]{}|\/\\-]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Compute term frequency map for a list of tokens.
 */
function computeTF(tokens) {
  const tf = {};
  const n = tokens.length || 1;
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  for (const t in tf) {
    tf[t] = tf[t] / n;
  }
  return tf;
}

// In-memory document corpus (all stored entities)
const corpus = new Map(); // id → { id, text, tokens, tf, embedding, category, organizationId, addedAt }

/**
 * Compute IDF (inverse document frequency) for a given term
 * across the entire corpus.
 */
function computeIDF(term) {
  let docCount = 0;
  for (const doc of corpus.values()) {
    if (doc.tf[term] !== undefined) docCount++;
  }
  const N = corpus.size || 1;
  return Math.log((N + 1) / (docCount + 1)) + 1; // smoothed
}

/**
 * Build a TF-IDF vector (sparse object) for a token list.
 * Uses current corpus IDF values.
 */
function buildTFIDFVector(tokens) {
  const tf = computeTF(tokens);
  const vector = {};
  for (const term in tf) {
    vector[term] = tf[term] * computeIDF(term);
  }
  return vector;
}

/**
 * Cosine similarity between two sparse TF-IDF vectors.
 */
function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const term in vecA) {
    magA += vecA[term] * vecA[term];
    if (vecB[term]) {
      dot += vecA[term] * vecB[term];
    }
  }
  for (const term in vecB) {
    magB += vecB[term] * vecB[term];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

// ─────────────────────────────────────────────
// CRUD operations
// ─────────────────────────────────────────────

/**
 * Add a sensitive entity to the knowledge graph.
 * @param {{ text: string, category: string, organizationId?: string }} params
 * @returns {{ id: string, text: string, category: string, addedAt: string }}
 */
export function addEntity({ text, category, organizationId = "default-org" }) {
  if (!text || !category) throw new Error("text and category are required");

  const id = randomUUID();
  const tokens = tokenize(text);
  const tf = computeTF(tokens);

  const entity = {
    id,
    text,
    tokens,
    tf,
    category,
    organizationId,
    addedAt: new Date().toISOString(),
  };

  corpus.set(id, entity);

  // Rebuild embeddings for all docs after adding (because IDF changes)
  _rebuildEmbeddings();

  return { id, text, category, organizationId, addedAt: entity.addedAt };
}

/** Rebuild TF-IDF embeddings for the entire corpus (needed after add/delete). */
function _rebuildEmbeddings() {
  for (const [id, doc] of corpus.entries()) {
    corpus.set(id, { ...doc, embedding: buildTFIDFVector(doc.tokens) });
  }
}

/**
 * Remove an entity by ID.
 * @param {string} id
 * @returns {boolean} true if removed
 */
export function removeEntity(id) {
  const existed = corpus.has(id);
  corpus.delete(id);
  if (existed) _rebuildEmbeddings();
  return existed;
}

/**
 * Get all entities, optionally filtered by organizationId.
 */
export function getAllEntities(organizationId = null) {
  const docs = [...corpus.values()];
  if (organizationId) return docs.filter((d) => d.organizationId === organizationId);
  return docs.map(({ id, text, category, organizationId: oid, addedAt }) => ({
    id, text, category, organizationId: oid, addedAt,
  }));
}

/**
 * Search for similar entities using cosine similarity.
 * @param {string} queryText - The query text
 * @param {{ topK?: number, threshold?: number, organizationId?: string }} options
 * @returns {Array<{ id, text, category, similarity }>}
 */
export function searchSimilar(queryText, { topK = 5, threshold = 0.1, organizationId = null } = {}) {
  if (corpus.size === 0) return [];

  const queryTokens = tokenize(queryText);
  const queryVec = buildTFIDFVector(queryTokens);

  const results = [];
  for (const doc of corpus.values()) {
    if (organizationId && doc.organizationId !== organizationId) continue;
    if (!doc.embedding) continue;
    const sim = cosineSimilarity(queryVec, doc.embedding);
    if (sim >= threshold) {
      results.push({
        id: doc.id,
        text: doc.text,
        category: doc.category,
        organizationId: doc.organizationId,
        addedAt: doc.addedAt,
        similarity: parseFloat(sim.toFixed(4)),
      });
    }
  }

  return results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

/**
 * Get knowledge graph statistics.
 */
export function getGraphStats() {
  const categoryCount = {};
  for (const doc of corpus.values()) {
    categoryCount[doc.category] = (categoryCount[doc.category] || 0) + 1;
  }
  return {
    totalEntities: corpus.size,
    categoryBreakdown: categoryCount,
  };
}
