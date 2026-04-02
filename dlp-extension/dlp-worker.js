/**
 * dlp-worker.js – GhostLayer DLP Web Worker
 *
 * Runs off the main UI thread. Handles:
 *   1. Pre-flight regex screening (fast path – avoids an API round-trip for clean text)
 *   2. Heavy text chunking / analysis for large pastes (e.g. PDF tables)
 *
 * The worker receives a { type, id, payload } message and replies with
 * { id, result } so the caller can match replies to requests.
 *
 * Usage from content.js:
 *   const worker = new Worker(chrome.runtime.getURL("dlp-worker.js"));
 *   worker.postMessage({ type: "PREFLIGHT", id: 1, payload: { text } });
 *   worker.onmessage = ({ data }) => { if (data.id === 1) handleResult(data.result); };
 */

"use strict";

// ── Regex patterns mirrored from api-server.js ──────────────────────────────
const PREFLIGHT_PATTERNS = [
  { type: "EMAIL",       re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/ },
  { type: "PHONE",       re: /(?:\+?\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{4}\b/ },
  { type: "CREDIT_CARD", re: /\b(?:\d[ \-]?){13,16}\b/ },
  { type: "ID_NUMBER",   re: /\b\d{9}\b/ },
  { type: "CREDENTIALS", re: /\b(password|secret|token|api[_\-]?key|credentials)\s*[:=]/i },
  { type: "ACCOUNT",     re: /\b\d{2,4}[-\s]\d{3,4}[-\s]\d{4,10}\b/ },
];

/**
 * Quick pre-flight scan using only regex (no network, no AI).
 * Returns { hasSensitive: boolean, types: string[] }
 *
 * This is the fast path: if no patterns match we skip the full API call entirely,
 * keeping the UI at 60 fps for the vast majority of "clean" paste events.
 *
 * @param {string} text
 * @returns {{ hasSensitive: boolean, types: string[] }}
 */
function preflightScan(text) {
  const matchedTypes = [];
  for (const { type, re } of PREFLIGHT_PATTERNS) {
    if (re.test(text)) matchedTypes.push(type);
  }
  return { hasSensitive: matchedTypes.length > 0, types: matchedTypes };
}

/**
 * Split a large text into chunks at sentence / paragraph boundaries.
 * Used so the main thread can stream large pastes to the API in pieces.
 *
 * @param {string} text
 * @param {number} [maxChunkSize=4000]  Max characters per chunk
 * @returns {string[]}
 */
function chunkText(text, maxChunkSize = 4000) {
  if (text.length <= maxChunkSize) return [text];

  const chunks = [];
  // Split on paragraph breaks first, then on sentences
  const paragraphs = text.split(/\n{2,}/);
  let current = "";

  for (const para of paragraphs) {
    if ((current + para).length > maxChunkSize) {
      if (current) { chunks.push(current.trim()); current = ""; }

      // Para is itself too large – split by sentence
      if (para.length > maxChunkSize) {
        const sentences = para.split(/(?<=[.!?])\s+/);
        for (const sentence of sentences) {
          if ((current + sentence).length > maxChunkSize) {
            if (current) { chunks.push(current.trim()); current = ""; }
            // Still too large – hard-split by character count
            for (let i = 0; i < sentence.length; i += maxChunkSize) {
              chunks.push(sentence.slice(i, i + maxChunkSize));
            }
          } else {
            current += (current ? " " : "") + sentence;
          }
        }
      } else {
        current = para;
      }
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ── Message handler ──────────────────────────────────────────────────────────
self.onmessage = function handleMessage({ data }) {
  const { type, id, payload } = data || {};

  if (type === "PREFLIGHT") {
    const { text = "" } = payload || {};
    const result = preflightScan(text);
    self.postMessage({ id, result });
    return;
  }

  if (type === "CHUNK_TEXT") {
    const { text = "", maxChunkSize } = payload || {};
    const chunks = chunkText(text, maxChunkSize);
    self.postMessage({ id, result: { chunks } });
    return;
  }

  // Unknown message – acknowledge with an error so callers don't hang
  self.postMessage({ id, result: { error: `Unknown message type: ${type}` } });
};
