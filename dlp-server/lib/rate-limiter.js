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
 * Environment variables:
 *   REDIS_URL        – Redis connection URL (default: redis://redis:6379)
 *   RATE_LIMIT_MAX   – max requests per window (default: 60)
 *   RATE_LIMIT_WINDOW_MS – window size in ms (default: 60000)
 */

import Redis from "ioredis";

const RATE_LIMIT_MAX    = parseInt(process.env.RATE_LIMIT_MAX        || "60",    10);
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS  || "60000", 10);

// Lazily create a single shared Redis client (cached on globalThis to survive
// Next.js hot-reloads in development).
function getRedisClient() {
  if (globalThis._rateLimitRedis) return globalThis._rateLimitRedis;

  const url = process.env.REDIS_URL || "redis://redis:6379";
  const client = new Redis(url, {
    // Do NOT crash the process on connection errors – fall back to passthrough.
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

  // If Redis is not connected, fail open (allow the request).
  if (client.status !== "ready" && client.status !== "connecting") {
    try {
      await client.connect();
    } catch {
      // Could not connect – degrade gracefully.
      return { allowed: true, remaining: RATE_LIMIT_MAX, retryAfter: 0 };
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
    // Add the current timestamp (use ms as both score and member for uniqueness)
    pipeline.zadd(redisKey, now, `${now}-${Math.random()}`);
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
    // On any Redis error, fail open.
    console.error("[rate-limiter] Redis command failed:", err.message);
    return { allowed: true, remaining: RATE_LIMIT_MAX, retryAfter: 0 };
  }
}
