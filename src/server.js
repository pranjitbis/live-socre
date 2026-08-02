const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const routes = require('./api/routes');
const logger = require('./logger');
const database = require('./database');
const cache = require('./cache');
const browserManager = require('./scraper/browser');
const { scraperService } = require('./services/scraperService');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

// Load environment variables
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// ============================================================
// ENSURE DIRECTORIES EXIST
// ============================================================

const ensureDirectories = () => {
  const dirs = [
    path.join(__dirname, '../logs'),
    path.join(__dirname, '../screenshots'),
    path.join(__dirname, '../data'),
    path.join(__dirname, '../debug'),
    path.join(__dirname, '../backups'),
    path.join(__dirname, '../public'),
  ];

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info(`Created directory: ${dir}`);
    }
  });
};

ensureDirectories();

// ============================================================
// SECURITY MIDDLEWARE
// ============================================================

app.use(
  helmet({
    contentSecurityPolicy: isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:', 'wss:'],
            connectSrc: ["'self'", 'wss:', 'ws:'],
          },
        }
      : false,
    crossOriginEmbedderPolicy: isProduction,
    crossOriginOpenerPolicy: isProduction,
    crossOriginResourcePolicy: isProduction,
    dnsPrefetchControl: isProduction,
    frameguard: isProduction,
    hidePoweredBy: true,
    hsts: isProduction,
    ieNoOpen: true,
    noSniff: true,
    originAgentCluster: isProduction,
    permittedCrossDomainPolicies: isProduction,
    referrerPolicy: isProduction,
    xssFilter: true,
  })
);

app.use(compression());

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID'],
    credentials: true,
    maxAge: 86400,
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX || 100,
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress || 'unknown';
  },
  skip: (req) => {
    if (!isProduction) {
      const ip = req.ip || req.connection.remoteAddress;
      if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
        return true;
      }
    }
    return false;
  },
});

app.use('/api', limiter);

// ============================================================
// REQUEST PARSING
// ============================================================

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================================
// SERVE STATIC FILES
// ============================================================

app.use(express.static(path.join(__dirname, '../public')));

app.get('/websocket-test', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/websocket-test.html'));
});

app.get('/live', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/test', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/websocket-test.html'));
});

// ============================================================
// REQUEST LOGGING
// ============================================================

app.use((req, res, next) => {
  const start = Date.now();
  const requestId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  logger.info(`[${requestId}] [${req.method}] ${req.url} - Started`);

  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusIcon = res.statusCode >= 400 ? '❌' : '✅';
    logger.info(
      `[${requestId}] ${statusIcon} [${req.method}] ${req.url} - ${res.statusCode} in ${duration}ms`
    );
  });

  next();
});

app.use((req, res, next) => {
  res.setHeader('X-Response-Time', Date.now());
  next();
});

// ============================================================
// HEALTH CHECK ENDPOINTS
// ============================================================

app.get('/health', async (req, res) => {
  const browserStats = browserManager.getStats ? browserManager.getStats() : {};
  const isBrowserHealthy = await browserManager.healthCheck().catch(() => false);

  let dbHealth = { healthy: false, mode: 'unknown' };
  try {
    if (database && typeof database.healthCheck === 'function') {
      dbHealth = await database.healthCheck();
    } else {
      dbHealth = { healthy: true, mode: 'unknown' };
    }
  } catch (error) {
    dbHealth = { healthy: false, mode: 'error', error: error.message };
  }

  let cacheHealth = { healthy: false, mode: 'unknown' };
  try {
    if (cache && typeof cache.getStatus === 'function') {
      const status = await cache.getStatus();
      cacheHealth = {
        healthy: true,
        mode: status.memoryMode ? 'memory' : 'redis',
        size: status.memorySize || 0,
      };
    } else {
      cacheHealth = { healthy: true, mode: 'unknown' };
    }
  } catch (error) {
    cacheHealth = { healthy: false, mode: 'error', error: error.message };
  }

  // Get real-time status
  let realtimeStatus = { isPolling: false, activeMatches: [] };
  try {
    if (scraperService && typeof scraperService.getRealTimeStatus === 'function') {
      realtimeStatus = scraperService.getRealTimeStatus();
    }
  } catch (error) {
    logger.warn('Could not get real-time status:', error.message);
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
    production: isProduction,
    memory: process.memoryUsage(),
    version: process.version,
    pid: process.pid,
    services: {
      database: dbHealth,
      cache: cacheHealth,
      browser: {
        ready: browserManager.isReady || false,
        healthy: isBrowserHealthy,
        stats: browserStats,
      },
      websocket: {
        enabled: true,
        clients: wss ? wss.clients.size : 0,
      },
      realtime: realtimeStatus,
    },
    requestId: req.requestId,
  });
});

// Browser health check
app.get('/health/browser', async (req, res) => {
  try {
    const isHealthy = await browserManager.healthCheck();
    const stats = browserManager.getStats ? browserManager.getStats() : {};

    res.json({
      healthy: isHealthy,
      ready: browserManager.isReady || false,
      stats: stats,
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    });
  } catch (error) {
    logger.error('Browser health check failed:', error);
    res.status(500).json({
      healthy: false,
      error: error.message,
      requestId: req.requestId,
    });
  }
});

// Database health check
app.get('/health/database', async (req, res) => {
  try {
    let health = { healthy: false, mode: 'unknown' };

    if (database && typeof database.healthCheck === 'function') {
      health = await database.healthCheck();
    } else {
      health = { healthy: true, mode: 'unknown' };
    }

    res.json({
      ...health,
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    });
  } catch (error) {
    logger.error('Database health check failed:', error);
    res.status(500).json({
      healthy: false,
      error: error.message,
      requestId: req.requestId,
    });
  }
});

// Cache health check
app.get('/health/cache', async (req, res) => {
  try {
    let health = { healthy: false, mode: 'unknown' };

    if (cache && typeof cache.getStatus === 'function') {
      const status = await cache.getStatus();
      health = {
        healthy: true,
        mode: status.memoryMode ? 'memory' : 'redis',
        size: status.memorySize || 0,
      };
    } else {
      health = { healthy: true, mode: 'unknown' };
    }

    res.json({
      ...health,
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    });
  } catch (error) {
    logger.error('Cache health check failed:', error);
    res.status(500).json({
      healthy: false,
      error: error.message,
      requestId: req.requestId,
    });
  }
});

// WebSocket health check
app.get('/health/websocket', (req, res) => {
  res.json({
    healthy: true,
    enabled: true,
    clients: wss ? wss.clients.size : 0,
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
  });
});

// ============================================================
// ROOT ENDPOINT
// ============================================================

app.get('/', (req, res) => {
  res.json({
    name: 'Cricket Scraper Framework',
    version: require('../package.json').version || '1.0.0',
    status: 'running',
    environment: NODE_ENV,
    production: isProduction,
    uptime: process.uptime(),
    endpoints: {
      health: '/health',
      'health/browser': '/health/browser',
      'health/database': '/health/database',
      'health/cache': '/health/cache',
      'health/websocket': '/health/websocket',
      api: {
        scrapeLive: '/api/scrape/live',
        scrapeUpcoming: '/api/scrape/upcoming',
        scrapeFinished: '/api/scrape/finished',
        matches: '/api/matches',
        cleanup: '/api/cleanup',
        'browser/stats': '/api/browser/stats',
        'scrape/all': '/api/scrape/all',
        realtime: {
          start: '/api/realtime/start',
          stop: '/api/realtime/stop',
          status: '/api/realtime/status',
        },
      },
      websocket: {
        endpoint: `ws://localhost:${PORT}/ws`,
        events: {
          connection: 'Client connected',
          'live:update': 'Real-time live score updates',
          'live:new': 'New match started',
          'live:complete': 'Match completed',
          'match:update': 'Match data updated',
          'score:update': 'Score updated',
          'commentary:new': 'New commentary',
        },
      },
      web: {
        'websocket-test': '/websocket-test',
        live: '/live',
        test: '/test',
      },
    },
    requestId: req.requestId,
  });
});

// ============================================================
// 🔥 NEW: REAL-TIME API ROUTES
// ============================================================

/**
 * @route POST /api/realtime/start
 * @desc Start real-time updates (5 second polling)
 */
app.post('/api/realtime/start', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const { interval = 5000 } = req.body;

  try {
    const result = await scraperService.startRealTimeUpdates({
      interval: interval,
      onMatchUpdate: (match, changes) => {
        // Broadcast via WebSocket
        broadcast({
          type: 'live:update',
          data: {
            match: match,
            changes: changes,
            timestamp: new Date().toISOString(),
          },
        });
        logger.debug(`📊 Match ${match.match_id} updated and broadcast`);
      },
      onMatchComplete: (match) => {
        broadcast({
          type: 'live:complete',
          data: {
            match: match,
            timestamp: new Date().toISOString(),
          },
        });
        logger.info(`✅ Match ${match.match_id} completed and broadcast`);
      },
      onNewMatch: (match) => {
        broadcast({
          type: 'live:new',
          data: {
            match: match,
            timestamp: new Date().toISOString(),
          },
        });
        logger.info(`🆕 New match ${match.match_id} started and broadcast`);
      },
    });

    res.json({
      success: result,
      message: result ? 'Real-time updates started (5 second interval)' : 'Already running',
      interval: interval,
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error starting real-time:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

/**
 * @route POST /api/realtime/stop
 * @desc Stop real-time updates
 */
app.post('/api/realtime/stop', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    const result = scraperService.stopRealTimeUpdates();
    res.json({
      success: result,
      message: result ? 'Real-time updates stopped' : 'Not running',
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error stopping real-time:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

/**
 * @route GET /api/realtime/status
 * @desc Get real-time status
 */
app.get('/api/realtime/status', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    const status = scraperService.getRealTimeStatus();
    res.json({
      success: true,
      data: status,
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error getting real-time status:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

// ============================================================
// WEBSOCKET SERVER
// ============================================================

const server = http.createServer(app);
let wss = null;
let lastScrapeHash = '';
let autoUpdateInterval = null;
let clientCounter = 0;

const clients = new Map();

function broadcast(data, excludeClient = null) {
  if (!wss) return;

  const message = JSON.stringify(data);
  let sentCount = 0;

  wss.clients.forEach((client) => {
    if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
        sentCount++;
      } catch (error) {
        logger.error('Error broadcasting to client:', error.message);
      }
    }
  });

  if (sentCount > 0) {
    logger.debug(`📡 Broadcast sent to ${sentCount} clients`);
  }
}

function sendToClient(client, data) {
  if (client && client.readyState === WebSocket.OPEN) {
    try {
      client.send(JSON.stringify(data));
      return true;
    } catch (error) {
      logger.error('Error sending to client:', error.message);
      return false;
    }
  }
  return false;
}

function setupWebSocket() {
  try {
    wss = new WebSocket.Server({
      server,
      path: '/ws',
      clientTracking: true,
      maxPayload: 10 * 1024 * 1024, // 10MB
    });

    logger.info(`✅ WebSocket server initialized on ws://localhost:${PORT}/ws`);

    wss.on('connection', (ws, req) => {
      const clientId = `client_${++clientCounter}_${Date.now()}`;
      const ip = req.socket.remoteAddress || 'unknown';

      clients.set(clientId, {
        ws,
        ip,
        clientId,
        connectedAt: new Date(),
        subscriptions: new Set(['live']),
        messageCount: 0,
      });

      logger.info(
        `🔌 WebSocket client connected: ${clientId} (IP: ${ip}) | Total clients: ${wss.clients.size}`
      );

      // Send welcome message
      sendToClient(ws, {
        type: 'connection',
        data: {
          clientId,
          timestamp: new Date().toISOString(),
          message: 'Connected to Cricket Scraper WebSocket Server',
          serverTime: new Date().toISOString(),
          totalClients: wss.clients.size,
        },
      });

      // Send current live matches immediately
      sendLiveMatches(ws);

      ws.on('message', async (message) => {
        try {
          const messageStr = typeof message === 'string' ? message : message.toString();
          logger.debug(
            `📨 Raw WebSocket message from ${clientId}: ${messageStr.substring(0, 200)}`
          );

          const data = JSON.parse(messageStr);
          const client = clients.get(clientId);
          if (client) {
            client.messageCount++;
          }
          await handleWebSocketMessage(ws, clientId, data);
        } catch (error) {
          logger.error(`WebSocket message error from ${clientId}:`, {
            error: error.message,
            stack: error.stack,
            message: typeof message === 'string' ? message.substring(0, 500) : 'Binary message',
          });

          sendToClient(ws, {
            type: 'error',
            data: {
              message: 'Invalid message format',
              error: error.message,
              timestamp: new Date().toISOString(),
            },
          });
        }
      });

      ws.on('close', () => {
        const client = clients.get(clientId);
        if (client) {
          logger.info(
            `🔌 WebSocket client disconnected: ${clientId} (IP: ${client.ip}, Messages: ${client.messageCount}) | Total clients: ${wss.clients.size - 1}`
          );
        } else {
          logger.info(
            `🔌 WebSocket client disconnected: ${clientId} | Total clients: ${wss.clients.size - 1}`
          );
        }
        clients.delete(clientId);
      });

      ws.on('error', (error) => {
        logger.error(`WebSocket error for ${clientId}:`, error.message);
        clients.delete(clientId);
      });
    });

    wss.on('error', (error) => {
      logger.error('WebSocket server error:', error);
    });

    return true;
  } catch (error) {
    logger.error('Failed to initialize WebSocket server:', error);
    return false;
  }
}

async function handleWebSocketMessage(ws, clientId, data) {
  const client = clients.get(clientId);
  if (!client) {
    logger.warn(`Client ${clientId} not found`);
    return;
  }

  const { type, payload } = data;

  if (!type) {
    sendToClient(ws, {
      type: 'error',
      data: {
        message: 'Missing message type',
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  logger.debug(`📨 Processing message type: ${type} from ${clientId}`);

  try {
    switch (type) {
      case 'subscribe':
        handleSubscribe(ws, clientId, payload);
        break;

      case 'unsubscribe':
        handleUnsubscribe(ws, clientId, payload);
        break;

      case 'ping':
        sendToClient(ws, {
          type: 'pong',
          data: {
            timestamp: new Date().toISOString(),
            clientId: clientId,
            serverTime: Date.now(),
          },
        });
        break;

      case 'getLiveMatches':
        await sendLiveMatches(ws);
        break;

      case 'getMatchDetails':
        if (payload && payload.matchId) {
          await sendMatchDetails(ws, payload.matchId);
        } else {
          sendToClient(ws, {
            type: 'error',
            data: {
              message: 'Missing matchId in payload',
              timestamp: new Date().toISOString(),
            },
          });
        }
        break;

      case 'getCommentary':
        if (payload && payload.matchId) {
          await sendCommentary(ws, payload.matchId);
        } else {
          sendToClient(ws, {
            type: 'error',
            data: {
              message: 'Missing matchId in payload',
              timestamp: new Date().toISOString(),
            },
          });
        }
        break;

      case 'getUpcomingMatches':
        await sendUpcomingMatches(ws, payload);
        break;

      case 'forceScrape':
        await forceScrapeAndSend(ws, payload);
        break;

      default:
        logger.warn(`Unknown message type: ${type} from ${clientId}`);
        sendToClient(ws, {
          type: 'error',
          data: {
            message: `Unknown message type: ${type}`,
            timestamp: new Date().toISOString(),
          },
        });
    }
  } catch (error) {
    logger.error(`Error handling message type ${type} from ${clientId}:`, {
      error: error.message,
      stack: error.stack,
    });

    sendToClient(ws, {
      type: 'error',
      data: {
        message: `Error processing ${type}: ${error.message}`,
        timestamp: new Date().toISOString(),
      },
    });
  }
}

function handleSubscribe(ws, clientId, payload) {
  const client = clients.get(clientId);
  if (!client) return;

  const topics = payload?.topics || ['live'];

  if (!Array.isArray(topics)) {
    sendToClient(ws, {
      type: 'error',
      data: {
        message: 'Topics must be an array',
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  topics.forEach((topic) => {
    if (typeof topic === 'string') {
      client.subscriptions.add(topic);
    }
  });

  sendToClient(ws, {
    type: 'subscribed',
    data: {
      topics: Array.from(client.subscriptions),
      timestamp: new Date().toISOString(),
    },
  });

  logger.info(
    `📡 Client ${clientId} subscribed to: ${Array.from(client.subscriptions).join(', ')}`
  );
}

function handleUnsubscribe(ws, clientId, payload) {
  const client = clients.get(clientId);
  if (!client) return;

  const topics = payload?.topics || [];

  if (Array.isArray(topics)) {
    topics.forEach((topic) => {
      client.subscriptions.delete(topic);
    });
  }

  sendToClient(ws, {
    type: 'unsubscribed',
    data: {
      topics: Array.isArray(topics) ? topics : [],
      timestamp: new Date().toISOString(),
    },
  });

  logger.info(
    `📡 Client ${clientId} unsubscribed from: ${Array.isArray(topics) ? topics.join(', ') : 'invalid topics'}`
  );
}

// ============================================================
// WEBSOCKET DATA SENDERS
// ============================================================

async function sendLiveMatches(ws) {
  try {
    let matches = await cache.get('crex_live_matches');

    if (!matches) {
      const result = await scraperService.scrapeLive();
      if (result && result.success && result.data) {
        matches = result.data;
        await cache.set('crex_live_matches', matches, 5);
      }
    }

    if (!Array.isArray(matches)) {
      logger.warn('Live matches data is not an array, defaulting to empty array');
      matches = [];
    }

    sendToClient(ws, {
      type: 'live:update',
      data: {
        matches: matches,
        count: matches.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error sending live matches:', error);
    sendToClient(ws, {
      type: 'live:update',
      data: {
        matches: [],
        count: 0,
        error: 'Failed to fetch live matches',
        timestamp: new Date().toISOString(),
      },
    });
  }
}

async function sendMatchDetails(ws, matchId) {
  try {
    const match = await scraperService.getMatchDetails(matchId);

    sendToClient(ws, {
      type: 'match:details',
      data: {
        matchId,
        match: match || null,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error(`Error sending match details for ${matchId}:`, error);
    sendToClient(ws, {
      type: 'match:details',
      data: {
        matchId,
        error: 'Failed to fetch match details',
        timestamp: new Date().toISOString(),
      },
    });
  }
}

async function sendCommentary(ws, matchId) {
  try {
    let commentary = (await cache.get(`commentary_${matchId}`)) || [];

    if (!Array.isArray(commentary)) {
      commentary = [];
    }

    sendToClient(ws, {
      type: 'commentary:update',
      data: {
        matchId,
        commentary,
        count: commentary.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error(`Error sending commentary for ${matchId}:`, error);
    sendToClient(ws, {
      type: 'commentary:update',
      data: {
        matchId,
        error: 'Failed to fetch commentary',
        timestamp: new Date().toISOString(),
      },
    });
  }
}

async function sendUpcomingMatches(ws, payload) {
  try {
    const page = payload?.page || 1;
    const limit = payload?.limit || 10;

    let matches = await cache.get('crex_upcoming_matches');

    if (!matches) {
      const result = await scraperService.scrapeUpcoming();
      if (result && result.success && result.data) {
        matches = result.data;
        await cache.set('crex_upcoming_matches', matches, 5);
      }
    }

    if (!Array.isArray(matches)) {
      logger.warn('Upcoming matches data is not an array, defaulting to empty array');
      matches = [];
    }

    const start = (page - 1) * limit;
    const end = start + limit;
    const paginated = matches.slice(start, end);

    sendToClient(ws, {
      type: 'upcoming:update',
      data: {
        matches: paginated,
        total: matches.length,
        page,
        limit,
        totalPages: Math.ceil(matches.length / limit),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error sending upcoming matches:', error);
    sendToClient(ws, {
      type: 'upcoming:update',
      data: {
        error: 'Failed to fetch upcoming matches',
        timestamp: new Date().toISOString(),
      },
    });
  }
}

async function forceScrapeAndSend(ws, payload) {
  try {
    const type = payload?.type || 'live';

    sendToClient(ws, {
      type: 'scrape:start',
      data: {
        type,
        message: `Starting ${type} scrape...`,
        timestamp: new Date().toISOString(),
      },
    });

    let result;
    if (type === 'live') {
      result = await scraperService.scrapeLive();
    } else if (type === 'upcoming') {
      result = await scraperService.scrapeUpcoming();
    } else if (type === 'finished') {
      result = await scraperService.scrapeFinished();
    } else {
      result = await scraperService.scrapeAll();
    }

    const matches = result && result.success && Array.isArray(result.data) ? result.data : [];

    sendToClient(ws, {
      type: 'scrape:complete',
      data: {
        type,
        matches: matches,
        count: matches.length,
        timestamp: new Date().toISOString(),
      },
    });

    broadcast({
      type: type === 'live' ? 'live:update' : `${type}:update`,
      data: {
        matches: matches,
        count: matches.length,
        timestamp: new Date().toISOString(),
      },
    });

    logger.info(`📡 Force scrape ${type} completed: ${matches.length} matches`);
  } catch (error) {
    logger.error(`Force scrape error:`, error);
    sendToClient(ws, {
      type: 'scrape:error',
      data: {
        error: error.message,
        timestamp: new Date().toISOString(),
      },
    });
  }
}

// ============================================================
// 🔥 START REAL-TIME UPDATES ON SERVER START
// ============================================================

async function startRealTimeUpdates() {
  try {
    logger.info('🔄 Starting 5-second real-time update service...');

    const started = await scraperService.startRealTimeUpdates({
      interval: 5000, // 5 seconds
      onMatchUpdate: (match, changes) => {
        // Broadcast to all WebSocket clients
        broadcast({
          type: 'live:update',
          data: {
            match: match,
            changes: changes,
            timestamp: new Date().toISOString(),
          },
        });

        // Log only significant changes
        if (changes.newScore !== changes.previousScore) {
          logger.info(
            `📊 ${match.teams.home.name} vs ${match.teams.away.name}: ${changes.previousScore} → ${changes.newScore}`
          );
        }
      },
      onMatchComplete: (match) => {
        broadcast({
          type: 'live:complete',
          data: {
            match: match,
            timestamp: new Date().toISOString(),
          },
        });
        logger.info(`✅ Match completed: ${match.teams.home.name} vs ${match.teams.away.name}`);
      },
      onNewMatch: (match) => {
        broadcast({
          type: 'live:new',
          data: {
            match: match,
            timestamp: new Date().toISOString(),
          },
        });
        logger.info(`🆕 New match started: ${match.teams.home.name} vs ${match.teams.away.name}`);
      },
    });

    if (started) {
      logger.info('✅ 5-second real-time updates started successfully');
    } else {
      logger.warn('⚠️ Real-time updates already running or failed to start');
    }

    return started;
  } catch (error) {
    logger.error('❌ Failed to start real-time updates:', error.message);
    return false;
  }
}

// ============================================================
// AUTO-UPDATE SCRAPING SERVICE (Legacy, kept for compatibility)
// ============================================================

async function startAutoScraping() {
  logger.info('🔄 Starting auto-scraping service for WebSocket updates...');

  // Scrape immediately on startup
  await performScrapeAndBroadcast();

  // Set up interval (every 10 seconds for real-time updates)
  const interval = parseInt(process.env.AUTO_SCRAPE_INTERVAL) || 10000;
  autoUpdateInterval = setInterval(async () => {
    try {
      await performScrapeAndBroadcast();
    } catch (error) {
      logger.error('Auto-scrape error:', error);
    }
  }, interval);

  logger.info(`✅ Auto-scraping service started (interval: ${interval}ms)`);
}

async function performScrapeAndBroadcast() {
  try {
    if (!wss || wss.clients.size === 0) {
      return;
    }

    const result = await scraperService.scrapeLive();

    if (result && result.success) {
      const matches = Array.isArray(result.data) ? result.data : [];

      if (matches.length > 0) {
        const hash = JSON.stringify(matches);

        if (hash !== lastScrapeHash) {
          lastScrapeHash = hash;

          broadcast({
            type: 'live:update',
            data: {
              matches: matches,
              count: matches.length,
              timestamp: new Date().toISOString(),
            },
          });

          logger.info(
            `📡 Broadcast ${matches.length} live matches to ${wss.clients.size} WebSocket clients`
          );
        } else {
          logger.debug(`📡 No changes in live matches (${matches.length} matches)`);
        }
      }
    }
  } catch (error) {
    logger.error('Scrape error:', error);
  }
}

function stopAutoScraping() {
  if (autoUpdateInterval) {
    clearInterval(autoUpdateInterval);
    autoUpdateInterval = null;
    logger.info('⏹️ Auto-scraping service stopped');
  }
}

// ============================================================
// API ROUTES
// ============================================================

app.use('/api', routes);

// ============================================================
// 404 HANDLER
// ============================================================

app.use((req, res) => {
  logger.warn(`[${req.requestId || 'unknown'}] 404 - Route not found: ${req.method} ${req.url}`);
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.url,
    method: req.method,
    requestId: req.requestId,
  });
});

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use((err, req, res, next) => {
  const errorDetails = {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.body,
    query: req.query,
    params: req.params,
  };

  if (isProduction) {
    logger.error(`[${req.requestId || 'unknown'}] Unhandled error: ${err.message}`);
  } else {
    logger.error(`[${req.requestId || 'unknown'}] Unhandled error:`, errorDetails);
  }

  const errorResponse = {
    success: false,
    error: isProduction ? 'Internal server error' : err.message,
    requestId: req.requestId,
  };

  if (!isProduction) {
    errorResponse.stack = err.stack;
    errorResponse.details = err;
  }

  res.status(err.status || 500).json(errorResponse);
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  const forceShutdownTimeout = setTimeout(() => {
    logger.error('Force shutdown after timeout');
    process.exit(1);
  }, 30000);

  try {
    // Stop real-time updates
    if (scraperService && typeof scraperService.stopRealTimeUpdates === 'function') {
      scraperService.stopRealTimeUpdates();
    }

    // Stop auto-scraping
    stopAutoScraping();

    // Close WebSocket connections
    if (wss) {
      logger.info('Closing WebSocket connections...');
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.close(1000, 'Server shutting down');
        }
      });

      await new Promise((resolve) => {
        wss.close(() => {
          logger.info('✅ WebSocket server closed');
          resolve();
        });
      });
    }

    // Cleanup scrapers
    logger.info('Cleaning up scrapers...');
    if (scraperService && typeof scraperService.cleanup === 'function') {
      await scraperService.cleanup();
    }

    // Close browser
    logger.info('Closing browser...');
    if (browserManager && typeof browserManager.close === 'function') {
      await browserManager.close();
    }

    // Close database connections
    if (database && typeof database.close === 'function') {
      logger.info('Closing database connections...');
      await database.close();
    }

    // Close cache connections
    if (cache && typeof cache.close === 'function') {
      logger.info('Closing cache connections...');
      await cache.close();
    }

    logger.info('✅ Graceful shutdown completed successfully');
    clearTimeout(forceShutdownTimeout);
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    clearTimeout(forceShutdownTimeout);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================================
// UNCAUGHT EXCEPTION HANDLING
// ============================================================

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', {
    error: error.message,
    stack: error.stack,
  });

  if (isProduction) {
    logger.error('Uncaught exception, attempting to recover...');
  } else {
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', {
    reason: reason instanceof Error ? reason.message : reason,
    promise: promise,
  });

  if (isProduction) {
    logger.error('Unhandled rejection, attempting to recover...');
  } else {
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
});

// ============================================================
// INITIALIZE SERVICES
// ============================================================

const initializeServices = async () => {
  try {
    logger.info('Initializing services...');

    if (database && typeof database.init === 'function') {
      try {
        await database.init();
        logger.info('✅ Database initialized');
      } catch (error) {
        logger.warn('Database initialization failed, running in fallback mode:', error.message);
      }
    }

    if (cache && typeof cache.init === 'function') {
      try {
        await cache.init();
        const status = await cache.getStatus();
        logger.info(`✅ Cache initialized (mode: ${status.memoryMode ? 'memory' : 'redis'})`);
      } catch (error) {
        logger.warn('Cache initialization failed, running in fallback mode:', error.message);
      }
    }

    logger.info('✅ All services initialized');
  } catch (error) {
    logger.error('Failed to initialize services:', error);
  }
};

// ============================================================
// START SERVER
// ============================================================

const startServer = () => {
  try {
    const wsInitialized = setupWebSocket();

    if (!wsInitialized) {
      logger.warn('⚠️ WebSocket server failed to initialize, continuing without WebSocket support');
    }

    server.listen(PORT, async () => {
      logger.info('='.repeat(80));
      logger.info('🏏 CRICKET SCRAPER FRAMEWORK');
      logger.info('='.repeat(80));
      logger.info(`🚀 Server running on http://localhost:${PORT}`);
      logger.info(`🔌 WebSocket endpoint: ws://localhost:${PORT}/ws`);
      logger.info(
        `🌍 Environment: ${NODE_ENV}${isProduction ? ' (PRODUCTION)' : ' (DEVELOPMENT)'}`
      );
      logger.info(`🔧 Node Version: ${process.version}`);
      logger.info(`🆔 Process ID: ${process.pid}`);
      logger.info(`💾 Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
      logger.info(`📡 Health Check: http://localhost:${PORT}/health`);
      logger.info('='.repeat(80));

      logger.info('📋 Available Endpoints:');
      logger.info(`  GET  /health - Health check`);
      logger.info(`  GET  /health/browser - Browser health check`);
      logger.info(`  GET  /health/database - Database health check`);
      logger.info(`  GET  /health/cache - Cache health check`);
      logger.info(`  GET  /health/websocket - WebSocket health check`);
      logger.info(`  GET  /api/scrape/live - Scrape live matches`);
      logger.info(`  GET  /api/scrape/upcoming - Scrape upcoming matches`);
      logger.info(`  GET  /api/scrape/finished - Scrape finished matches`);
      logger.info(`  GET  /api/scrape/all - Scrape all matches`);
      logger.info(`  GET  /api/matches - Get matches from database`);
      logger.info(`  POST /api/cleanup - Cleanup hanging scrapers`);
      logger.info(`  GET  /api/browser/stats - Browser statistics`);
      logger.info(`  POST /api/realtime/start - Start 5s real-time updates`);
      logger.info(`  POST /api/realtime/stop - Stop real-time updates`);
      logger.info(`  GET  /api/realtime/status - Get real-time status`);
      logger.info('='.repeat(80));

      logger.info('📡 WebSocket Events (Auto-updates every 5s):');
      logger.info(`  connection - Client connected`);
      logger.info(`  live:update - Real-time live score updates (every 5s)`);
      logger.info(`  live:new - New match started`);
      logger.info(`  live:complete - Match completed`);
      logger.info(`  match:update - Match data updated`);
      logger.info(`  commentary:new - New commentary`);
      logger.info(`  score:update - Score updated`);
      logger.info(`  upcoming:update - Upcoming matches updated`);
      logger.info(`  scrape:start/complete/error - Force scrape events`);
      logger.info('='.repeat(80));

      logger.info('🌐 Web Pages:');
      logger.info(`  /websocket-test - WebSocket test page`);
      logger.info(`  /live - Live scores page`);
      logger.info(`  /test - Test page`);
      logger.info('='.repeat(80));

      // 🔥 Start 5-second real-time updates
      await startRealTimeUpdates();

      // Start legacy auto-scraping (for compatibility)
      await startAutoScraping();
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(
          `❌ Port ${PORT} is already in use. Please use a different port or stop the other process.`
        );
        process.exit(1);
      } else {
        logger.error('Server error:', error);
        process.exit(1);
      }
    });

    app.set('server', server);
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// ============================================================
// MAIN
// ============================================================

const main = async () => {
  try {
    await initializeServices();
    startServer();
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
};

main();

// ============================================================
// EXPORTS
// ============================================================

module.exports = { app, server, wss };
