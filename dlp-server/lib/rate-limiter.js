/**
 * Redis-backed sliding-window rate limiter.
 *
 * Uses a Redis sorted-set per key to implement a true sliding window.
 * Each entry is the request timestamp (ms).  On every request we:
 *   1. Remove entries older than the window.
 *   2. Count remaining entries.
 *   3. If count >= limit → reject (429).
 *   4. Otherwise add the new timestamp and set a TTL on the key.
 *
 * When Redis is unavailable the limiter falls back to an in-memory
 * sliding-window token bucket (fail-secure).  The in-memory store enforces
 * the same RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS constraints so that a Redis
 * outage cannot be exploited to bypass rate limiting.
 *
 * Environment variables:
 *   REDIS_URL        – Redis connection URL (default: redis://redis:6379)
 *   RATE_LIMIT_MAX   – max requests per window (default: 60)
 *   RATE_LIMIT_WINDOW_MS – window size in ms (default: 60000)
 */

import Redis from "ioredis";

export const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX       || "60",    10);
const RATE_LIMIT_WINDOW     = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);

// ── In-memory token-bucket fallback ──────────────────────────────────────────
// Keyed by the rate-limit key; each entry is an array of request timestamps
// within the current window.  Stored on globalThis so that Next.js hot-reloads
// in development share a single in-process store.
if (!globalThis._rateLimitMemoryBuckets) {
  globalThis._rateLimitMemoryBuckets = new Map();
}

// Periodically evict keys whose most-recent request falls outside the window to
// prevent the Map from growing without bound over long-running deployments.
if (!globalThis._rateLimitMemoryCleanup) {
  const timer = setInterval(() => {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW;
    for (const [key, timestamps] of globalThis._rateLimitMemoryBuckets) {
      const pruned = timestamps.filter((ts) => ts > cutoff);
      if (pruned.length === 0) {
        globalThis._rateLimitMemoryBuckets.delete(key);
      } else {
        globalThis._rateLimitMemoryBuckets.set(key, pruned);
      }
    }
  }, RATE_LIMIT_WINDOW);
  // Do not keep the Node.js process alive just for cleanup.
  timer.unref();
  globalThis._rateLimitMemoryCleanup = timer;
}

/**
 * In-memory sliding-window rate check used when Redis is unavailable.
 * This is fail-SECURE: it enforces the limit even during a Redis outage.
 */
function checkInMemoryRateLimit(key) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  const buckets = globalThis._rateLimitMemoryBuckets;

  // Prune timestamps outside the window and fetch the live bucket.
  const bucket = (buckets.get(key) || []).filter((ts) => ts > windowStart);

  if (bucket.length >= RATE_LIMIT_MAX) {
    // bucket is sorted ascending (oldest entries at index 0) because new timestamps
    // are appended and stale entries are filtered out each call.
    const retryAfter = Math.ceil((bucket[0] + RATE_LIMIT_WINDOW - now) / 1000);
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfter: Math.max(1, retryAfter) };
  }

  bucket.push(now);
  buckets.set(key, bucket);
  return { allowed: true, remaining: RATE_LIMIT_MAX - bucket.length, retryAfter: 0 };
}

// ── Redis client ──────────────────────────────────────────────────────────────

// Monotonically-increasing counter to ensure unique sorted-set members even
// when multiple requests arrive in the same millisecond.
let _seq = 0;

// Lazily create a single shared Redis client (cached on globalThis to survive
// Next.js hot-reloads in development).
function getRedisClient() {
  if (globalThis._rateLimitRedis) return globalThis._rateLimitRedis;

  const url = process.env.REDIS_URL || "redis://redis:6379";
  const client = new Redis(url, {
    // Do NOT crash the process on connection errors – fall back to in-memory bucket.
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null, // disable automatic reconnect retries
  });

  client.on("error", (err) => {
    // Suppress noisy ECONNREFUSED logs in environments without Redis.
    if (err.code !== "ECONNREFUSED" && err.code !== "ENOTFOUND") {
      console.error("[rate-limiter] Redis error:", err.message);
    }
  });

  globalThis._rateLimitRedis = client;
  return client;
}

/**
 * Check and record a request for the given key.
 *
 * @param {string} key  – identifier (e.g. API key or IP address)
 * @returns {Promise<{ allowed: boolean, remaining: number, retryAfter: number }>}
 */
export async function checkRateLimit(key) {
  const client = getRedisClient();

  // If Redis is not connected, fall back to the in-memory token bucket (fail-secure).
  if (client.status !== "ready" && client.status !== "connecting") {
    try {
      await client.connect();
    } catch {
      // Could not connect – use in-memory rate limiter instead of failing open.
      return checkInMemoryRateLimit(key);
    }
  }

  const redisKey  = `rl:${key}`;
  const now       = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;

  try {
    const pipeline = client.pipeline();
    // Remove timestamps outside the current window
    pipeline.zremrangebyscore(redisKey, "-inf", windowStart);
    // Count requests still in the window
    pipeline.zcard(redisKey);
    // Add the current timestamp; use a per-process sequence number to guarantee
    // uniqueness even when multiple requests arrive in the same millisecond.
    pipeline.zadd(redisKey, now, `${now}-${++_seq}`);
    // Expire the key slightly after the window so it self-cleans
    pipeline.pexpire(redisKey, RATE_LIMIT_WINDOW + 1000);

    const results = await pipeline.exec();
    // results[1] is [err, count] from zcard (before the new entry was added)
    const countBefore = results[1][1];

    if (countBefore >= RATE_LIMIT_MAX) {
      const remaining = 0;
      // Estimate when the oldest entry will fall out of the window
      const oldest = await client.zrange(redisKey, 0, 0, "WITHSCORES");
      const oldestTs = oldest.length >= 2 ? parseInt(oldest[1], 10) : now;
      const retryAfter = Math.ceil((oldestTs + RATE_LIMIT_WINDOW - now) / 1000);
      return { allowed: false, remaining, retryAfter: Math.max(1, retryAfter) };
    }

    return {
      allowed:    true,
      remaining:  RATE_LIMIT_MAX - countBefore - 1,
      retryAfter: 0,
    };
  } catch (err) {
    // On any Redis command error, fall back to the in-memory token bucket (fail-secure).
    console.error("[rate-limiter] Redis command failed, using in-memory fallback:", err.message);
    return checkInMemoryRateLimit(key);
  }
}
