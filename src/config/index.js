require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  env: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.MYSQLURL || null,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'railway',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
    waitForConnections: true,
    queueLimit: 0,
  },

  redis: {
    user: process.env.REDIS_REDISUSER || 'default',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB) || 0,
    keyPrefix: 'cricket:',
  },

  cache: {
    ttl: {
      live: parseInt(process.env.CACHE_TTL_LIVE) || 5,
      commentary: parseInt(process.env.CACHE_TTL_COMMENTARY) || 3,
      fixtures: parseInt(process.env.CACHE_TTL_FIXTURES) || 60,
      points: parseInt(process.env.CACHE_TTL_POINTS) || 1800,
      news: parseInt(process.env.CACHE_TTL_NEWS) || 1800,
      match: parseInt(process.env.CACHE_TTL_MATCH) || 3600,
    },
  },

  scraper: {
    timeout: parseInt(process.env.SCRAPER_TIMEOUT) || 30000,
    maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
    retryBackoffBase: parseInt(process.env.RETRY_BACKOFF_BASE) || 1000,
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_SCRAPES) || 5,
    requestDelay: {
      min: parseInt(process.env.REQUEST_DELAY_MIN) || 1000,
      max: parseInt(process.env.REQUEST_DELAY_MAX) || 3000,
    },
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || 'logs',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  },

  websocket: {
    pingInterval: parseInt(process.env.WS_PING_INTERVAL) || 30000,
    pingTimeout: parseInt(process.env.WS_PING_TIMEOUT) || 5000,
  },

  sources: require('./sources'),
};

module.exports = config;
