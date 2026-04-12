/**
 * semantic-cache.js – Redis-backed Semantic Cache for the GhostLayer pipeline
 *
 * Cascade Fast-Path (Tier 0.5 / Redis): if an identical – or structurally
 * identical – payload was analysed within the last hour, the cached
 * masking / blocking decision is returned immediately without waking any
 * AI models.
 *
 * Cache key derivation:
 *   SHA-256( lowercase( collapse-whitespace( text.slice(0, 1024) ) ) )
 *   → hex digest prefixed with "ghostlayer:semcache:"
 *
 * Keeping only the first 1 024 characters means that very long pastes that
 * share the same opening are treated as the same payload, which is the
 * correct behaviour for DLP checks (sensitive content usually appears near
 * the top).  The SHA-256 digest makes collisions cryptographically negligible.
 *
 * TTL: 3 600 seconds (1 hour).
 *
 * All errors are silently swallowed so that a Redis outage never blocks a
 * detection request – the agent degrades gracefully to full-pipeline mode.
 */

import { createHash } from "crypto";
import { getRedisClient } from "./redis-client.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 3_600;        // 1 hour
const CACHE_KEY_PREFIX  = "ghostlayer:semcache:";
const MAX_TEXT_FOR_KEY  = 1_024;        // chars used to derive the cache key

// ── Key derivation ────────────────────────────────────────────────────────────

/**
 * Derive a deterministic, privacy-safe Redis key from the input text.
 *
 * The key is a SHA-256 digest of the normalised text prefix so that:
 *   • The raw text is never stored in the key itself.
 *   • Minor formatting differences (extra spaces, mixed case) that would
 *     produce the same detection outcome share a single cache entry.
 *
 * @param {string} text  Raw input text.
 * @returns {string}  E.g. "ghostlayer:semcache:a1b2c3…"
 */
export function deriveCacheKey(text) {
  const normalised = text
    .slice(0, MAX_TEXT_FOR_KEY)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const hex = createHash("sha256").update(normalised, "utf8").digest("hex");
  return `${CACHE_KEY_PREFIX}${hex}`;
}

// ── Cache read ────────────────────────────────────────────────────────────────

/**
 * Attempt to retrieve a previously cached inspection result from Redis.
 *
 * Returns `null` on a cache miss, a Redis error, or a JSON parse failure.
 * Callers should fall through to the full detection pipeline on `null`.
 *
 * The returned object has an additional `_cacheHit: true` property so
 * callers can distinguish cache hits for logging / telemetry.
 *
 * @param {string} text  Raw input text.
 * @returns {Promise<object | null>}
 */
export async function getCachedResult(text) {
  try {
    const redis  = getRedisClient();
    const key    = deriveCacheKey(text);
    const stored = await redis.get(key);
    if (!stored) return null;

    const result = JSON.parse(stored);
    result._cacheHit = true;
    return result;
  } catch {
    // Redis unavailable or JSON parse error – fall through to live analysis.
    return null;
  }
}

// ── Cache write ───────────────────────────────────────────────────────────────

/**
 * Store a detection pipeline result in Redis with a 1-hour TTL.
 *
 * The `vault` field (which maps masking tokens to original sensitive values)
 * is intentionally omitted from the cached payload: vaults are one-time
 * artefacts tied to the specific request, and re-serialising them into Redis
 * would store plaintext PII in the cache.  On a cache replay the caller
 * receives `maskedText` (already anonymised) and an empty vault.
 *
 * Errors are silently swallowed so a Redis write failure never blocks the
 * HTTP response.
 *
 * @param {string} text    Raw input text (key is derived from this).
 * @param {object} result  The detection pipeline result to cache.
 * @returns {Promise<void>}
 */
export async function setCachedResult(text, result) {
  try {
    const redis = getRedisClient();
    const key   = deriveCacheKey(text);

    // Omit the vault to avoid caching raw PII in Redis.
    const { vault: _omit, ...rest } = result;
    const toStore = { ...rest, _cachedAt: Date.now() };

    await redis.set(key, JSON.stringify(toStore), "EX", CACHE_TTL_SECONDS);
  } catch {
    // Non-fatal: cache write failure is silently ignored.
  }
}
