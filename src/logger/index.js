// src/logger/index.js
const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const logDir = config.logging.dir || 'logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Helper to safely stringify objects with circular references
const safeStringify = (obj) => {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    // Don't stringify error stacks as objects
    if (key === 'stack' && typeof value === 'string') {
      return value;
    }
    return value;
  }, 2);
};

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      try {
        // Only stringify if not an error object with circular refs
        if (meta.error && typeof meta.error === 'object') {
          const errorObj = {
            message: meta.error.message || 'Unknown error',
            status: meta.error.status || meta.error.statusCode,
            code: meta.error.code
          };
          metaStr = ` ${JSON.stringify(errorObj)}`;
        } else {
          metaStr = ` ${safeStringify(meta)}`;
        }
      } catch (e) {
        metaStr = ' [Unable to stringify meta]';
      }
    }
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const logger = winston.createLogger({
  level: config.logging.level || 'info',
  defaultMeta: { service: 'cricket-scraper' },
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
      level: process.env.NODE_ENV === 'development' ? 'debug' : 'info'
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'app.log'),
      format: fileFormat,
      maxsize: parseInt(process.env.LOG_FILE_MAX_SIZE) || 20 * 1024 * 1024,
      maxFiles: parseInt(process.env.LOG_FILE_MAX_FILES) || 7,
      tailable: true
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      format: fileFormat,
      level: 'error',
      maxsize: parseInt(process.env.LOG_FILE_MAX_SIZE) || 20 * 1024 * 1024,
      maxFiles: parseInt(process.env.LOG_FILE_MAX_FILES) || 7,
      tailable: true
    })
  ]
});

// Override error logging to handle circular references
const originalError = logger.error.bind(logger);
logger.error = function(message, meta = {}) {
  if (meta && meta.error && typeof meta.error === 'object') {
    // Extract only safe properties from error
    const safeError = {
      message: meta.error.message || 'Unknown error',
      status: meta.error.status || meta.error.statusCode,
      code: meta.error.code,
      name: meta.error.name
    };
    if (meta.error.stack) {
      safeError.stack = meta.error.stack;
    }
    meta.error = safeError;
  }
  return originalError(message, meta);
};

logger.debug = (message, meta = {}) => {
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
    logger.log('debug', message, meta);
  }
};

module.exports = logger;