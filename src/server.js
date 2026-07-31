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
const WS_PORT = process.env.WS_PORT || 3001;
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
    path.join(__dirname, '../backups')
  ];
  
  dirs.forEach(dir => {
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

// Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: isProduction ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "wss:"],
      connectSrc: ["'self'", "wss:", "ws:"],
    },
  } : false,
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
}));

// Compression
app.use(compression());

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'WS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Upgrade', 'Connection'],
  exposedHeaders: ['X-Request-ID'],
  credentials: true,
  maxAge: 86400 // 24 hours
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.RATE_LIMIT_MAX || 100,
  message: {
    success: false,
    error: 'Too many requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress || 'unknown';
  },
  skip: (req) => {
    // Skip rate limiting for localhost in development
    if (!isProduction) {
      const ip = req.ip || req.connection.remoteAddress;
      if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
        return true;
      }
    }
    return false;
  }
});

// Apply rate limiting to API routes
app.use('/api', limiter);

// ============================================================
// REQUEST PARSING
// ============================================================

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================================
// REQUEST LOGGING WITH REQUEST ID
// ============================================================

app.use((req, res, next) => {
  const start = Date.now();
  const requestId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  req.requestId = requestId;
  
  // Set request ID header
  res.setHeader('X-Request-ID', requestId);
  
  // Log request
  logger.info(`[${requestId}] [${req.method}] ${req.url} - Started`);
  
  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusIcon = res.statusCode >= 400 ? '❌' : '✅';
    logger.info(`[${requestId}] ${statusIcon} [${req.method}] ${req.url} - ${res.statusCode} in ${duration}ms`);
  });
  
  next();
});

// ============================================================
// RESPONSE TIME HEADER
// ============================================================

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
    } else if (database && typeof database.isMemoryMode === 'function') {
      dbHealth = { 
        healthy: true, 
        mode: database.isMemoryMode() ? 'memory' : 'database' 
      };
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
        size: status.memorySize || 0
      };
    } else {
      cacheHealth = { healthy: true, mode: 'unknown' };
    }
  } catch (error) {
    cacheHealth = { healthy: false, mode: 'error', error: error.message };
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
        stats: browserStats
      },
      websocket: {
        enabled: true,
        port: WS_PORT,
        clients: wss ? wss.clients.size : 0
      }
    },
    requestId: req.requestId
  });
});

app.get('/health/browser', async (req, res) => {
  try {
    const isHealthy = await browserManager.healthCheck();
    const stats = browserManager.getStats ? browserManager.getStats() : {};
    
    res.json({
      healthy: isHealthy,
      ready: browserManager.isReady || false,
      stats: stats,
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
  } catch (error) {
    logger.error('Browser health check failed:', error);
    res.status(500).json({
      healthy: false,
      error: error.message,
      requestId: req.requestId
    });
  }
});

app.get('/health/database', async (req, res) => {
  try {
    let health = { healthy: false, mode: 'unknown' };
    
    if (database && typeof database.healthCheck === 'function') {
      health = await database.healthCheck();
    } else if (database && typeof database.isMemoryMode === 'function') {
      health = { 
        healthy: true, 
        mode: database.isMemoryMode() ? 'memory' : 'database' 
      };
    } else {
      health = { healthy: true, mode: 'unknown' };
    }
    
    res.json({
      ...health,
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
  } catch (error) {
    logger.error('Database health check failed:', error);
    res.status(500).json({
      healthy: false,
      error: error.message,
      requestId: req.requestId
    });
  }
});

app.get('/health/cache', async (req, res) => {
  try {
    let health = { healthy: false, mode: 'unknown' };
    
    if (cache && typeof cache.getStatus === 'function') {
      const status = await cache.getStatus();
      health = { 
        healthy: true, 
        mode: status.memoryMode ? 'memory' : 'redis',
        size: status.memorySize || 0
      };
    } else {
      health = { healthy: true, mode: 'unknown' };
    }
    
    res.json({
      ...health,
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
  } catch (error) {
    logger.error('Cache health check failed:', error);
    res.status(500).json({
      healthy: false,
      error: error.message,
      requestId: req.requestId
    });
  }
});

app.get('/health/websocket', (req, res) => {
  res.json({
    healthy: true,
    enabled: true,
    port: WS_PORT,
    clients: wss ? wss.clients.size : 0,
    timestamp: new Date().toISOString(),
    requestId: req.requestId
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
        'scrape/all': '/api/scrape/all'
      },
      websocket: {
        endpoint: `ws://localhost:${WS_PORT}`,
        events: {
          'live:update': 'Live score updates',
          'live:new': 'New match started',
          'live:complete': 'Match completed',
          'match:update': 'Match data updated',
          'commentary:new': 'New commentary',
          'score:update': 'Score updated'
        }
      }
    },
    requestId: req.requestId
  });
});

// ============================================================
// WEBSOCKET SERVER
// ============================================================

// Create HTTP server
const server = http.createServer(app);
let wss = null;

const clients = new Map();

function broadcast(data, excludeClient = null) {
  if (!wss) return;
  
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function sendToClient(client, data) {
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(data));
  }
}

function setupWebSocket() {
  try {
    wss = new WebSocket.Server({ 
      server, 
      path: '/ws',
      clientTracking: true,
      maxPayload: 10 * 1024 * 1024 // 10MB
    });
    
    logger.info(`✅ WebSocket server initialized on ws://localhost:${PORT}/ws`);
    
    wss.on('connection', (ws, req) => {
      const clientId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      
      // Get client IP
      const ip = req.socket.remoteAddress || 'unknown';
      
      // Store client info
      clients.set(clientId, {
        ws,
        ip,
        connectedAt: new Date(),
        subscriptions: new Set()
      });
      
      logger.info(`🔌 WebSocket client connected: ${clientId} (IP: ${ip})`);
      
      // Send welcome message
      sendToClient(ws, {
        type: 'connection',
        data: {
          clientId,
          timestamp: new Date().toISOString(),
          message: 'Connected to Cricket Scraper WebSocket Server',
          serverTime: new Date().toISOString()
        }
      });
      
      // Send current live matches immediately
      sendLiveMatches(ws);
      
      ws.on('message', async (message) => {
        try {
          const data = typeof message === 'string' ? JSON.parse(message) : JSON.parse(message.toString());
          await handleWebSocketMessage(ws, clientId, data);
        } catch (error) {
          logger.error(`WebSocket message error:`, error.message);
          sendToClient(ws, {
            type: 'error',
            data: {
              message: 'Invalid message format',
              error: error.message
            }
          });
        }
      });
      
      ws.on('close', () => {
        logger.info(`🔌 WebSocket client disconnected: ${clientId}`);
        clients.delete(clientId);
      });
      
      ws.on('error', (error) => {
        logger.error(`WebSocket error for ${clientId}:`, error.message);
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
  if (!client) return;
  
  const { type, payload } = data;
  
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
        data: { timestamp: new Date().toISOString() }
      });
      break;
      
    case 'getLiveMatches':
      await sendLiveMatches(ws);
      break;
      
    case 'getMatchDetails':
      if (payload && payload.matchId) {
        await sendMatchDetails(ws, payload.matchId);
      }
      break;
      
    case 'getCommentary':
      if (payload && payload.matchId) {
        await sendCommentary(ws, payload.matchId);
      }
      break;
      
    default:
      sendToClient(ws, {
        type: 'error',
        data: {
          message: 'Unknown message type',
          type: type
        }
      });
  }
}

function handleSubscribe(ws, clientId, payload) {
  const client = clients.get(clientId);
  if (!client) return;
  
  const topics = payload?.topics || ['live'];
  
  topics.forEach(topic => {
    client.subscriptions.add(topic);
  });
  
  sendToClient(ws, {
    type: 'subscribed',
    data: {
      topics: topics,
      timestamp: new Date().toISOString()
    }
  });
  
  logger.info(`📡 Client ${clientId} subscribed to: ${topics.join(', ')}`);
}

function handleUnsubscribe(ws, clientId, payload) {
  const client = clients.get(clientId);
  if (!client) return;
  
  const topics = payload?.topics || [];
  
  topics.forEach(topic => {
    client.subscriptions.delete(topic);
  });
  
  sendToClient(ws, {
    type: 'unsubscribed',
    data: {
      topics: topics,
      timestamp: new Date().toISOString()
    }
  });
  
  logger.info(`📡 Client ${clientId} unsubscribed from: ${topics.join(', ')}`);
}

async function sendLiveMatches(ws) {
  try {
    const cached = await cache.get('crex_live_matches');
    const matches = cached || [];
    
    sendToClient(ws, {
      type: 'live:update',
      data: {
        matches,
        count: matches.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error sending live matches:', error);
    sendToClient(ws, {
      type: 'live:update',
      data: {
        matches: [],
        count: 0,
        error: 'Failed to fetch live matches',
        timestamp: new Date().toISOString()
      }
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
        match,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    sendToClient(ws, {
      type: 'match:details',
      data: {
        matchId,
        error: 'Failed to fetch match details',
        timestamp: new Date().toISOString()
      }
    });
  }
}

async function sendCommentary(ws, matchId) {
  try {
    // Get commentary from cache or database
    const commentary = await cache.get(`commentary_${matchId}`) || [];
    
    sendToClient(ws, {
      type: 'commentary:update',
      data: {
        matchId,
        commentary,
        count: commentary.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    sendToClient(ws, {
      type: 'commentary:update',
      data: {
        matchId,
        error: 'Failed to fetch commentary',
        timestamp: new Date().toISOString()
      }
    });
  }
}

// Broadcast live score updates to all subscribed clients
async function broadcastLiveUpdate(matchData) {
  if (!wss) return;
  
  const message = {
    type: 'live:update',
    data: {
      match: matchData,
      timestamp: new Date().toISOString()
    }
  };
  
  broadcast(message);
}

// Broadcast new match
async function broadcastNewMatch(matchData) {
  if (!wss) return;
  
  const message = {
    type: 'live:new',
    data: {
      match: matchData,
      timestamp: new Date().toISOString()
    }
  };
  
  broadcast(message);
}

// Broadcast match completion
async function broadcastMatchComplete(matchData) {
  if (!wss) return;
  
  const message = {
    type: 'live:complete',
    data: {
      match: matchData,
      timestamp: new Date().toISOString()
    }
  };
  
  broadcast(message);
}

// Broadcast score update
async function broadcastScoreUpdate(matchId, scoreData) {
  if (!wss) return;
  
  const message = {
    type: 'score:update',
    data: {
      matchId,
      score: scoreData,
      timestamp: new Date().toISOString()
    }
  };
  
  broadcast(message);
}

// Broadcast commentary
async function broadcastCommentary(matchId, commentaryItem) {
  if (!wss) return;
  
  const message = {
    type: 'commentary:new',
    data: {
      matchId,
      commentary: commentaryItem,
      timestamp: new Date().toISOString()
    }
  };
  
  broadcast(message);
}

// ============================================================
// START WEBSOCKET SCRAPING SERVICE
// ============================================================

let scrapingInterval = null;
let lastScrapeHash = '';

async function startScrapingService() {
  logger.info('🔄 Starting automatic scraping service...');
  
  // Scrape immediately on startup
  await performScrape();
  
  // Set up interval
  const interval = process.env.SCRAPE_INTERVAL || 30000; // 30 seconds default
  scrapingInterval = setInterval(async () => {
    try {
      await performScrape();
    } catch (error) {
      logger.error('Auto-scrape error:', error);
    }
  }, parseInt(interval));
  
  logger.info(`✅ Automatic scraping service started (interval: ${interval}ms)`);
}

async function performScrape() {
  try {
    // Scrape live matches
    const result = await scraperService.scrapeLive();
    
    if (result && result.success && result.data && result.data.length > 0) {
      // Check if data has changed
      const hash = JSON.stringify(result.data);
      
      if (hash !== lastScrapeHash) {
        lastScrapeHash = hash;
        
        // Broadcast updates
        await broadcastLiveUpdate({
          matches: result.data,
          count: result.data.length,
          timestamp: new Date().toISOString()
        });
        
        logger.info(`📡 Broadcast ${result.data.length} live matches to WebSocket clients`);
      }
    }
  } catch (error) {
    logger.error('Scrape error:', error);
  }
}

function stopScrapingService() {
  if (scrapingInterval) {
    clearInterval(scrapingInterval);
    scrapingInterval = null;
    logger.info('⏹️ Automatic scraping service stopped');
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
    requestId: req.requestId
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
    params: req.params
  };
  
  if (isProduction) {
    logger.error(`[${req.requestId || 'unknown'}] Unhandled error: ${err.message}`);
  } else {
    logger.error(`[${req.requestId || 'unknown'}] Unhandled error:`, errorDetails);
  }
  
  const errorResponse = {
    success: false,
    error: isProduction ? 'Internal server error' : err.message,
    requestId: req.requestId
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
    // Stop scraping service
    stopScrapingService();
    
    // Close WebSocket connections
    if (wss) {
      logger.info('Closing WebSocket connections...');
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.close(1000, 'Server shutting down');
        }
      });
      
      await new Promise(resolve => {
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
    if (cache && typeof cache.closeRedis === 'function') {
      logger.info('Closing cache connections...');
      await cache.closeRedis();
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

// Register signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================================
// UNCAUGHT EXCEPTION HANDLING
// ============================================================

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', {
    error: error.message,
    stack: error.stack
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
    promise: promise
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
// INITIALIZE BROWSER ON STARTUP
// ============================================================

const initializeBrowser = async () => {
  try {
    logger.info('Initializing browser on startup...');
    if (browserManager && typeof browserManager.launch === 'function') {
      await browserManager.launch();
      logger.info('✅ Browser initialized successfully');
    }
  } catch (error) {
    logger.warn('⚠️ Browser initialization failed on startup, will retry on demand:', error.message);
  }
};

// ============================================================
// START SERVER
// ============================================================

const startServer = () => {
  try {
    // Setup WebSocket
    const wsInitialized = setupWebSocket();
    
    if (!wsInitialized) {
      logger.warn('⚠️ WebSocket server failed to initialize, continuing without WebSocket support');
    }
    
    // Start the combined HTTP + WebSocket server
    server.listen(PORT, async () => {
      logger.info('='.repeat(80));
      logger.info('🏏 CRICKET SCRAPER FRAMEWORK');
      logger.info('='.repeat(80));
      logger.info(`🚀 Server running on http://localhost:${PORT}`);
      logger.info(`🔌 WebSocket endpoint: ws://localhost:${PORT}/ws`);
      logger.info(`🌍 Environment: ${NODE_ENV}${isProduction ? ' (PRODUCTION)' : ' (DEVELOPMENT)'}`);
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
      logger.info('='.repeat(80));
      
      logger.info('📡 WebSocket Events:');
      logger.info(`  live:update - Live score updates`);
      logger.info(`  live:new - New match started`);
      logger.info(`  live:complete - Match completed`);
      logger.info(`  match:update - Match data updated`);
      logger.info(`  commentary:new - New commentary`);
      logger.info(`  score:update - Score updated`);
      logger.info('='.repeat(80));
      
      // Initialize browser in background
      await initializeBrowser();
      
      // Start automatic scraping service
      await startScrapingService();
    });
    
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`❌ Port ${PORT} is already in use. Please use a different port or stop the other process.`);
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
// INITIALIZE SERVICES
// ============================================================

const initializeServices = async () => {
  try {
    logger.info('Initializing services...');
    
    // Initialize database (optional)
    if (database && typeof database.init === 'function') {
      try {
        await database.init();
        const health = await database.healthCheck();
        logger.info(`✅ Database initialized (mode: ${health.mode || 'unknown'})`);
      } catch (error) {
        logger.warn('⚠️ Database initialization failed, running in fallback mode:', error.message);
      }
    } else if (database && typeof database.initDatabase === 'function') {
      try {
        await database.initDatabase();
        logger.info('✅ Database initialized');
      } catch (error) {
        logger.warn('⚠️ Database initialization failed, running in fallback mode:', error.message);
      }
    }
    
    // Initialize cache (optional)
    if (cache && typeof cache.initRedis === 'function') {
      try {
        await cache.initRedis();
        const status = await cache.getStatus();
        logger.info(`✅ Cache initialized (mode: ${status.memoryMode ? 'memory' : 'redis'})`);
      } catch (error) {
        logger.warn('⚠️ Cache initialization failed, running in fallback mode:', error.message);
      }
    } else if (cache && typeof cache.init === 'function') {
      try {
        await cache.init();
        logger.info('✅ Cache initialized');
      } catch (error) {
        logger.warn('⚠️ Cache initialization failed, running in fallback mode:', error.message);
      }
    }
    
    logger.info('✅ All services initialized');
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    // Continue anyway - services will work in fallback mode
  }
};

// ============================================================
// MAIN
// ============================================================

const main = async () => {
  try {
    // Initialize services
    await initializeServices();
    
    // Start the server
    startServer();
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
};

// Run the main function
main();

// ============================================================
// EXPORTS FOR TESTING
// ============================================================

module.exports = { app, server, wss };