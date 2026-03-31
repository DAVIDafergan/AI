/**
 * lib/ai-brain/ingestion.js
 *
 * Local RAG Pipeline – Document Ingestion Engine
 * ────────────────────────────────────────────────
 * • Splits raw text into overlapping chunks
 * • Computes TF-IDF embeddings (pure JS – no external model server)
 * • Stores vectors in an in-memory FAISS-like index
 * • Zero data leaves the local environment
 */

import { randomUUID } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CHUNK_SIZE    = 512;   // characters per chunk
const DEFAULT_CHUNK_OVERLAP = 128;   // overlap between consecutive chunks
const EMBEDDING_DIMENSIONS  = 384;   // target dimensionality for dense projection

// ─────────────────────────────────────────────────────────────────────────────
// In-memory vector store (FAISS-style flat index)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ id: string, docId: string, chunkIndex: number, text: string,
 *             tokens: string[], tf: Object, embedding: number[],
 *             metadata: Object, ingestedAt: string }} VectorEntry
 */

/** @type {Map<string, VectorEntry>} */
const vectorIndex = new Map();

/** Inverted index: term → Set of entry IDs (for fast lookup) */
const invertedIndex = new Map();

/** Global IDF denominator – total distinct documents (not chunks) */
const docSet = new Set();

// ─────────────────────────────────────────────────────────────────────────────
// Tokeniser (Hebrew + Latin, no stop-words removal – keep it broad)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tokenise text into lower-cased word tokens.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[\s,.–:;!?"'()\[\]{}|\/\\@#%^&*+=~`<>]+/)
    .filter((t) => t.length >= 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// TF-IDF Embedding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute term-frequency map for a token list.
 * @param {string[]} tokens
 * @returns {Object<string, number>}
 */
function computeTF(tokens) {
  const tf = Object.create(null);
  const n  = tokens.length || 1;
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1 / n;
  return tf;
}

/**
 * Smooth IDF for a term using the current corpus.
 * @param {string} term
 * @returns {number}
 */
function computeIDF(term) {
  const df = invertedIndex.has(term) ? invertedIndex.get(term).size : 0;
  const N  = docSet.size || 1;
  return Math.log((N + 1) / (df + 1)) + 1;
}

/**
 * Sparse TF-IDF vector for a token list.
 * @param {string[]} tokens
 * @returns {Object<string, number>}
 */
function buildSparseVector(tokens) {
  const tf  = computeTF(tokens);
  const vec = Object.create(null);
  for (const term in tf) {
    vec[term] = tf[term] * computeIDF(term);
  }
  return vec;
}

/**
 * Project a sparse TF-IDF vector to a fixed-length dense float array using a
 * deterministic random projection (Johnson-Lindenstrauss sketch).
 *
 * The projection matrix is derived from term hashes, so it is stable across
 * calls without requiring storage.
 *
 * @param {Object<string, number>} sparseVec
 * @returns {number[]}
 */
function projectToDense(sparseVec) {
  const dense = new Float64Array(EMBEDDING_DIMENSIONS);
  for (const [term, weight] of Object.entries(sparseVec)) {
    // Two independent hash seeds for ±1 sign and bucket selection
    const h1 = hashTerm(term, 0x9e3779b9);
    const h2 = hashTerm(term, 0x6c62272e);
    const dim  = Math.abs(h1) % EMBEDDING_DIMENSIONS;
    const sign = h2 & 1 ? 1 : -1;
    dense[dim] += sign * weight;
  }
  // L2-normalise
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) norm += dense[i] * dense[i];
  norm = Math.sqrt(norm) || 1;
  const result = new Array(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) result[i] = dense[i] / norm;
  return result;
}

/**
 * Deterministic 32-bit hash for a string + seed.
 * @param {string} str
 * @param {number} seed
 * @returns {number}
 */
function hashTerm(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h  = Math.imul(h, 0x9e3779b9) >>> 0;
    h ^= h >>> 16;
  }
  return h;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chunking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split `text` into overlapping character-based chunks.
 *
 * @param {string} text
 * @param {{ chunkSize?: number, chunkOverlap?: number }} options
 * @returns {Array<{ chunkIndex: number, text: string, start: number, end: number }>}
 */
export function chunkText(text, { chunkSize = DEFAULT_CHUNK_SIZE, chunkOverlap = DEFAULT_CHUNK_OVERLAP } = {}) {
  if (!text || typeof text !== "string") return [];
  const step   = Math.max(1, chunkSize - chunkOverlap);
  const chunks = [];
  let index    = 0;

  for (let start = 0; start < text.length; start += step) {
    // Prefer to break at a word boundary
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > start) end = boundary;
    }
    chunks.push({ chunkIndex: index++, text: text.slice(start, end), start, end });
    if (end >= text.length) break;
  }

  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ingestion API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ingest a document into the local vector store.
 *
 * @param {string} docId       - Caller-supplied stable document identifier
 * @param {string} content     - Raw UTF-8 text content
 * @param {Object} [metadata]  - Arbitrary key/value metadata (e.g. filename, source)
 * @param {{ chunkSize?: number, chunkOverlap?: number }} [options]
 * @returns {{ docId: string, chunksIngested: number, vectorIds: string[] }}
 */
export function ingestDocument(docId, content, metadata = {}, options = {}) {
  if (!docId || typeof docId !== "string") throw new TypeError("docId must be a non-empty string");
  if (typeof content !== "string")         throw new TypeError("content must be a string");

  // Remove previously ingested chunks for this docId (idempotent re-ingestion)
  removeDocument(docId);

  const chunks     = chunkText(content, options);
  const vectorIds  = [];
  const ingestedAt = new Date().toISOString();

  docSet.add(docId);

  for (const chunk of chunks) {
    const id      = randomUUID();
    const tokens  = tokenize(chunk.text);
    const tf      = computeTF(tokens);
    const sparse  = buildSparseVector(tokens);
    const embedding = projectToDense(sparse);

    /** @type {VectorEntry} */
    const entry = {
      id,
      docId,
      chunkIndex : chunk.chunkIndex,
      text       : chunk.text,
      tokens,
      tf,
      embedding,
      metadata   : { ...metadata, charStart: chunk.start, charEnd: chunk.end },
      ingestedAt,
    };

    vectorIndex.set(id, entry);

    // Update inverted index
    for (const term of tokens) {
      if (!invertedIndex.has(term)) invertedIndex.set(term, new Set());
      invertedIndex.get(term).add(id);
    }

    vectorIds.push(id);
  }

  // Re-project embeddings for the entire corpus because IDF values changed
  _rebuildEmbeddings();

  return { docId, chunksIngested: chunks.length, vectorIds };
}

/**
 * Remove all chunks for a given document from the index.
 * @param {string} docId
 * @returns {number} Number of chunks removed
 */
export function removeDocument(docId) {
  let removed = 0;
  for (const [id, entry] of vectorIndex.entries()) {
    if (entry.docId === docId) {
      // Clean inverted index
      for (const term of entry.tokens) {
        const set = invertedIndex.get(term);
        if (set) {
          set.delete(id);
          if (set.size === 0) invertedIndex.delete(term);
        }
      }
      vectorIndex.delete(id);
      removed++;
    }
  }
  docSet.delete(docId);
  if (removed > 0) _rebuildEmbeddings();
  return removed;
}

/**
 * Re-compute embeddings for all stored entries (required after corpus changes).
 */
function _rebuildEmbeddings() {
  for (const [id, entry] of vectorIndex.entries()) {
    const sparse    = buildSparseVector(entry.tokens);
    const embedding = projectToDense(sparse);
    vectorIndex.set(id, { ...entry, sparse, embedding });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Query helpers (used by semantic-search.js)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Embed a raw text string into the same dense vector space.
 * @param {string} text
 * @returns {number[]}
 */
export function embedText(text) {
  const tokens = tokenize(text);
  const sparse = buildSparseVector(tokens);
  return projectToDense(sparse);
}

/**
 * Return the raw vector index iterator (read-only view).
 * @returns {IterableIterator<VectorEntry>}
 */
export function getVectorIndex() {
  return vectorIndex.values();
}

/**
 * Store statistics.
 */
export function getIndexStats() {
  return {
    totalChunks  : vectorIndex.size,
    totalDocuments: docSet.size,
    uniqueTerms  : invertedIndex.size,
    dimensions   : EMBEDDING_DIMENSIONS,
  };
}
