/**
 * Cache service abstraction for AI course Q&A responses.
 *
 * Current implementation: in-memory Map with LRU-style eviction.
 *
 * REDIS MIGRATION PLAN:
 * When deploying multi-instance (load balanced), replace this module with a
 * Redis-backed implementation. The interface is designed for easy swap:
 *
 *   // Redis replacement example:
 *   const Redis = require('ioredis');
 *   const redis = new Redis(process.env.REDIS_URL);
 *
 *   async function get(key) {
 *     const raw = await redis.get(`ai-cache:${key}`);
 *     return raw ? JSON.parse(raw) : null;
 *   }
 *
 *   async function set(key, value, ttlMs) {
 *     await redis.set(`ai-cache:${key}`, JSON.stringify(value), 'PX', ttlMs);
 *   }
 *
 *   async function del(key) {
 *     await redis.del(`ai-cache:${key}`);
 *   }
 *
 *   async function clear() {
 *     const keys = await redis.keys('ai-cache:*');
 *     if (keys.length) await redis.del(...keys);
 *   }
 *
 * NOTE: Notification cache in server.js uses session-based caching.
 * For multi-instance with Redis, replace with:
 *   Key: `notification-cache:{userId}`
 *   TTL: 5 minutes
 *   Value: JSON array of notifications
 */

const responseCache = new Map();
const maxCacheEntries = Number(process.env.AI_CACHE_MAX_ENTRIES || 100);
const DEFAULT_TTL_MS = Number(process.env.AI_CACHE_TTL_MS || 10 * 60 * 1000); // 10 minutes

function set(key, value, ttlMs) {
  if (responseCache.size >= maxCacheEntries) {
    const firstKey = responseCache.keys().next().value;
    if (firstKey) responseCache.delete(firstKey);
  }
  responseCache.set(key, { value, createdAt: Date.now(), ttlMs: ttlMs || DEFAULT_TTL_MS });
}

function get(key) {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > entry.ttlMs) {
    responseCache.delete(key);
    return null;
  }
  return entry.value;
}

function del(key) {
  responseCache.delete(key);
}

function clear() {
  responseCache.clear();
}

function size() {
  return responseCache.size;
}

module.exports = { set, get, del, clear, size };
