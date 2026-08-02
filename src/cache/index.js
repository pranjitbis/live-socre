// src/cache/index.js
const redis = require('redis');
const { promisify } = require('util');
const logger = require('../logger');
const config = require('../config');

let redisClient = null;
let isConnected = false;
let memoryMode = false;
let memoryCache = new Map();

async function initRedis() {
  try {
    // Check if Redis config exists
    if (!config.redis || !config.redis.host) {
      logger.warn('⚠️ Redis configuration missing, using in-memory cache');
      memoryMode = true;
      isConnected = true;
      return null;
    }

    redisClient = redis.createClient({
      host: config.redis.host || 'localhost',
      port: config.redis.port || 6379,
      password: config.redis.password || undefined,
      db: config.redis.db || 0,
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          logger.warn('⚠️ Redis connection refused, using in-memory cache');
          memoryMode = true;
          return false;
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          return new Error('Redis retry time exhausted');
        }
        if (options.attempt > 5) {
          logger.warn(`⚠️ Redis retry limit reached (${options.attempt}), using in-memory cache`);
          memoryMode = true;
          return false;
        }
        return Math.min(options.attempt * 100, 3000);
      },
    });

    redisClient.on('error', (error) => {
      logger.warn(`⚠️ Redis client error: ${error.message}`);
      isConnected = false;
      memoryMode = true;
    });

    redisClient.on('connect', () => {
      logger.info('✅ Redis client connected');
      isConnected = true;
      memoryMode = false;
    });

    redisClient.on('ready', () => {
      logger.info('✅ Redis client ready');
      isConnected = true;
      memoryMode = false;
    });

    redisClient.on('end', () => {
      logger.warn('⚠️ Redis client disconnected, using in-memory cache');
      isConnected = false;
      memoryMode = true;
    });

    // Connect with timeout
    const connectPromise = redisClient.connect();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
    
    await Promise.race([connectPromise, timeoutPromise]);
    
    logger.info('✅ Redis cache initialized successfully');
    return redisClient;
  } catch (error) {
    logger.warn(`⚠️ Redis initialization failed: ${error.message}`);
    logger.warn('⚠️ Using in-memory cache');
    memoryMode = true;
    isConnected = true;
    return null;
  }
}

function getRedisClient() {
  if (memoryMode || !redisClient || !isConnected) {
    // Return a mock client for memory mode
    return {
      get: async (key) => {
        const value = memoryCache.get(key);
        return value ? JSON.parse(value) : null;
      },
      set: async (key, value, options) => {
        memoryCache.set(key, value);
        return 'OK';
      },
      del: async (key) => {
        memoryCache.delete(key);
        return 1;
      },
      keys: async (pattern) => {
        const keys = [];
        for (const key of memoryCache.keys()) {
          if (key.includes(pattern.replace('*', ''))) {
            keys.push(key);
          }
        }
        return keys;
      }
    };
  }
  return redisClient;
}

async function closeRedis() {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch (error) {
      // Ignore
    }
    redisClient = null;
    isConnected = false;
    logger.info('✅ Redis connections closed');
  }
  memoryCache.clear();
}

// ============================================================
// EXPORT CACHE METHODS DIRECTLY
// ============================================================

// Export individual functions for direct access
async function get(key) {
  try {
    const client = getRedisClient();
    const value = await client.get(key);
    if (value) {
      return typeof value === 'string' ? JSON.parse(value) : value;
    }
    return null;
  } catch (error) {
    logger.debug('Cache get error:', { key, error: error.message });
    // Try memory cache fallback
    const memValue = memoryCache.get(key);
    return memValue || null;
  }
}

async function set(key, value, ttl = 3600) {
  try {
    const client = getRedisClient();
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttl) {
      await client.set(key, stringValue, { EX: ttl });
    } else {
      await client.set(key, stringValue);
    }
    // Also store in memory for fallback
    memoryCache.set(key, stringValue);
    return true;
  } catch (error) {
    logger.debug('Cache set error:', { key, error: error.message });
    // Store in memory fallback
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    memoryCache.set(key, stringValue);
    return false;
  }
}

async function del(key) {
  try {
    const client = getRedisClient();
    await client.del(key);
    memoryCache.delete(key);
    return true;
  } catch (error) {
    logger.debug('Cache delete error:', { key, error: error.message });
    memoryCache.delete(key);
    return false;
  }
}

async function clear(pattern = '*') {
  try {
    const client = getRedisClient();
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await Promise.all(keys.map((key) => client.del(key)));
    }
    // Clear memory cache
    if (pattern === '*') {
      memoryCache.clear();
    } else {
      const patternReg = new RegExp(pattern.replace('*', '.*'));
      for (const key of memoryCache.keys()) {
        if (patternReg.test(key)) {
          memoryCache.delete(key);
        }
      }
    }
    return keys.length;
  } catch (error) {
    logger.debug('Cache clear error:', { pattern, error: error.message });
    return 0;
  }
}

async function getOrSet(key, fetchFn, ttl = 3600) {
  try {
    const cached = await get(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    const value = await fetchFn();
    if (value !== null && value !== undefined) {
      await set(key, value, ttl);
    }
    return value;
  } catch (error) {
    logger.debug('Cache getOrSet error:', { key, error: error.message });
    return await fetchFn();
  }
}

async function getStatus() {
  return {
    connected: isConnected,
    memoryMode: memoryMode,
    keyPrefix: config.redis?.keyPrefix || 'cricket:',
    memorySize: memoryCache.size
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Initialization
  initRedis,
  closeRedis,
  getRedisClient,
  
  // Core methods
  get,
  set,
  del,
  clear,
  getOrSet,
  getStatus,
  
  // Backward compatibility
  init: initRedis,
  close: closeRedis,
  healthCheck: getStatus,
};