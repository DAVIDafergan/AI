// lib/mappingStore.js – Dedicated in-memory store for synthetic-to-original mappings
// TODO: Replace with MongoDB in production

// ── Internal store ────────────────────────────────────────────────────────────
const store = new Map(); // key = synthetic tag → { tag, originalText, category, label, timestamp, sessionId }

// ── Session ID generator (UUID-like, no external dependency) ─────────────────
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

let currentSessionId = generateSessionId();

/**
 * Save an array of mapping entries.
 * Each entry: { tag, originalText, category, label, timestamp? }
 */
export function saveMappings(mappingsArray) {
  const now = new Date().toISOString();
  for (const entry of mappingsArray) {
    store.set(entry.tag, {
      tag: entry.tag,
      originalText: entry.originalText,
      category: entry.category,
      label: entry.label,
      timestamp: entry.timestamp || now,
      sessionId: entry.sessionId || currentSessionId,
    });
  }
}

/**
 * Look up a single synthetic value and return the original, or null if not found.
 */
export function getOriginalByTag(tag) {
  return store.get(tag) || null;
}

/**
 * Return all stored mappings (for admin dashboard).
 */
export function getAllMappings() {
  return Array.from(store.values());
}

/**
 * Clear all mappings (admin function).
 */
export function clearMappings() {
  store.clear();
  currentSessionId = generateSessionId();
}

/**
 * Return count per category.
 */
export function getMappingStats() {
  const stats = {};
  for (const entry of store.values()) {
    const cat = entry.category || "OTHER";
    stats[cat] = (stats[cat] || 0) + 1;
  }
  return stats;
}

/**
 * Start a new session (generates a new sessionId for the next batch).
 */
export function newSession() {
  currentSessionId = generateSessionId();
  return currentSessionId;
}

/**
 * Get the current session ID.
 */
export function getCurrentSessionId() {
  return currentSessionId;
}
