/**
 * redis-client.js – Shared Redis client for the GhostLayer Local Agent
 *
 * Provides a lazily-initialised ioredis client instance.  All modules that
 * need Redis should import `getRedisClient()` from this file so that a single
 * connection is reused across the process.
 *
 * Configuration:
 *   REDIS_URL – Redis connection URL (default: redis://localhost:6379)
 *
 * The client is created on the first call to getRedisClient() and cached for
 * the lifetime of the process.  Connection errors are logged but treated as
 * non-fatal so that the agent can still start when Redis is temporarily
 * unavailable (graceful degradation falls back to in-memory behaviour).
 */

import Redis from "ioredis";

/** @type {Redis | null} */
let _client = null;

/**
 * Return (or create) the shared Redis client.
 * @returns {Redis}
 */
export function getRedisClient() {
  if (_client) return _client;

  const url = process.env.REDIS_URL || "redis://localhost:6379";

  _client = new Redis(url, {
    // Limit reconnection attempts so the agent does not hang indefinitely
    // when Redis is genuinely unavailable.
    maxRetriesPerRequest: 3,
    enableOfflineQueue:   false,
    lazyConnect:          false,
  });

  _client.on("error", (err) => {
    // Log but do not crash – callers handle Redis failures gracefully.
    console.warn(`[redis-client] Connection error: ${err.message}`);
  });

  _client.on("connect", () => {
    console.log("[redis-client] Connected to Redis.");
  });

  return _client;
}

/**
 * Gracefully close the Redis connection.
 * Call this during agent shutdown to ensure pending commands are flushed.
 * @returns {Promise<void>}
 */
export async function closeRedisClient() {
  if (_client) {
    await _client.quit();
    _client = null;
  }
}
