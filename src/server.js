const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const WebSocket = require('ws');

// Load environment variables
require('dotenv').config();

const routes = require('./api/routes');
const logger = require('./logger');
const database = require('./database');
const cache = require('./cache');
const browserManager = require('./scraper/browser');
const { scraperService } = require('./services/scraperService');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// ⭐ Auto-detect HTTPS based on environment
const IS_HTTPS = process.env.USE_HTTPS === 'true' || 
                 process.env.RAILWAY_ENVIRONMENT === 'production' ||
                 process.env.RENDER === 'true' ||
                 process.env.HEROKU_APP_NAME !== undefined ||
                 process.env.VERCEL === '1';

logger.info(`🔒 HTTPS mode: ${IS_HTTPS ? 'Enabled' : 'Disabled'}`);

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
            connectSrc: ["'self'", 'wss:', 'ws:', 'https:', 'http:'],
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
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'WS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Upgrade', 'Connection'],
    exposedHeaders: ['X-Request-ID'],
    credentials: true,
    maxAge: 86400,
  })
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX || 100,
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
// SERVE STATIC FILES
// ============================================================

const WEB_TEST_PATH = path.join(__dirname, 'web-test');
logger.info(`📁 Web test directory path: ${WEB_TEST_PATH}`);
logger.info(`📁 Directory exists: ${fs.existsSync(WEB_TEST_PATH)}`);

const indexPath = path.join(WEB_TEST_PATH, 'index.html');
if (fs.existsSync(indexPath)) {
  logger.info(`✅ index.html found at: ${indexPath}`);
} else {
  logger.warn(`⚠️ index.html NOT found at: ${indexPath}`);
}

app.use('/web-test', express.static(WEB_TEST_PATH));
app.use('/static', express.static(WEB_TEST_PATH));

app.get('/web-test', (req, res) => {
  const indexPath = path.join(WEB_TEST_PATH, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({
      success: false,
      error: 'index.html not found',
      path: indexPath,
    });
  }
});

app.get('/web-test/index.html', (req, res) => {
  const indexPath = path.join(WEB_TEST_PATH, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({
      success: false,
      error: 'index.html not found',
      path: indexPath,
    });
  }
});

app.get('/', (req, res) => {
  const indexPath = path.join(WEB_TEST_PATH, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    const protocol = IS_HTTPS ? 'wss' : 'ws';
    res.json({
      name: 'Cricket Scraper Framework',
      version: require('../package.json').version || '1.0.0',
      status: 'running',
      environment: NODE_ENV,
      production: isProduction,
      https: IS_HTTPS,
      uptime: process.uptime(),
      websocket: {
        protocol: protocol,
        path: '/ws',
        port: PORT,
        url: `${protocol}://${req.get('host') || 'localhost'}/ws`,
        autoDetect: true,
      },
      endpoints: {
        health: '/health',
        dashboard: '/web-test',
        api: '/api',
        live: '/api/live',
        broadcast: '/api/broadcast',
        ws: '/ws',
        'ws-info': '/api/ws-info',
      },
      requestId: req.requestId,
    });
  }
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
        mode: database.isMemoryMode() ? 'memory' : 'database',
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
        size: status.memorySize || 0,
      };
    } else {
      cacheHealth = { healthy: true, mode: 'unknown' };
    }
  } catch (error) {
    cacheHealth = { healthy: false, mode: 'error', error: error.message };
  }

  const protocol = IS_HTTPS ? 'wss' : 'ws';
  const wsUrl = `${protocol}://${req.get('host') || 'localhost'}/ws`;

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
    production: isProduction,
    https: IS_HTTPS,
    memory: process.memoryUsage(),
    version: process.version,
    pid: process.pid,
    websocket: {
      protocol: protocol,
      path: '/ws',
      url: wsUrl,
      clients: wss ? wss.clients.size : 0,
      autoDetect: true,
    },
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
        port: PORT,
        clients: wss ? wss.clients.size : 0,
        protocol: protocol,
      },
    },
    requestId: req.requestId,
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

app.get('/health/database', async (req, res) => {
  try {
    let health = { healthy: false, mode: 'unknown' };
    if (database && typeof database.healthCheck === 'function') {
      health = await database.healthCheck();
    } else if (database && typeof database.isMemoryMode === 'function') {
      health = {
        healthy: true,
        mode: database.isMemoryMode() ? 'memory' : 'database',
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
    logger.error('Database health check failed:', error);
    res.status(500).json({
      healthy: false,
      error: error.message,
      requestId: req.requestId,
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

app.get('/health/websocket', (req, res) => {
  const protocol = IS_HTTPS ? 'wss' : 'ws';
  res.json({
    healthy: true,
    enabled: true,
    port: PORT,
    clients: wss ? wss.clients.size : 0,
    protocol: protocol,
    url: `${protocol}://${req.get('host') || 'localhost'}/ws`,
    autoDetect: true,
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
  });
});

// ============================================================
// ✅ WEBSOCKET INFO ENDPOINT
// ============================================================

app.get('/api/ws-info', (req, res) => {
  const protocol = IS_HTTPS ? 'wss' : 'ws';
  const host = req.get('host') || 'localhost';
  const wsUrl = `${protocol}://${host}/ws`;

  res.json({
    success: true,
    websocket: {
      protocol: protocol,
      url: wsUrl,
      path: '/ws',
      secure: IS_HTTPS,
      clients: wss ? wss.clients.size : 0,
      supportedProtocols: ['ws', 'wss'],
      autoDetect: true,
      recommendations: {
        http: 'ws://',
        https: 'wss://',
      },
      connectionHelp: `Use ${wsUrl} for WebSocket connections`,
      clientExample: `
// Auto-detect WebSocket protocol
const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const wsUrl = \`\${protocol}://\${window.location.host}/ws\`;
const ws = new WebSocket(wsUrl);
      `,
    },
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// ✅ LIVE DATA API ENDPOINT
// ============================================================

app.get('/api/live', async (req, res) => {
  try {
    const result = await scraperService.scrapeLive(true);

    if (result && result.success) {
      const protocol = IS_HTTPS ? 'wss' : 'ws';
      res.json({
        success: true,
        data: result.data || [],
        total: result.total || 0,
        timestamp: new Date().toISOString(),
        websocket: {
          url: `${protocol}://${req.get('host') || 'localhost'}/ws`,
          protocol: protocol,
        },
      });
    } else {
      res.json({
        success: false,
        data: [],
        total: 0,
        error: result?.error || 'Failed to fetch live matches',
      });
    }
  } catch (error) {
    logger.error('Error fetching live matches:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      data: [],
    });
  }
});

// Temporary endpoint to debug production database connectivity
app.get('/api/db-debug', async (req, res) => {
  try {
    const dns = require('dns').promises;
    const db = require('./database');
    const config = require('./config');
    
    const dbConfig = {
      url: config.database.url ? config.database.url.replace(/:[^:@\n]+@/, ':****@') : null,
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      database: config.database.database,
      hasPassword: !!config.database.password,
    };

    const envKeys = Object.keys(process.env).filter(k => 
      k.includes('DB') || k.includes('MYSQL') || k.includes('DATABASE') || k.includes('RAILWAY')
    );

    const dnsResults = {};
    const hostsToResolve = ['mysql.railway.internal', 'db.railway.internal', config.database.host];
    for (const h of hostsToResolve) {
      if (h) {
        try {
          const ips = await dns.resolve4(h);
          dnsResults[h] = { success: true, ips };
        } catch (err) {
          dnsResults[h] = { success: false, error: err.message };
        }
      }
    }

    let connectionTest = null;
    try {
      const mysql2 = require('mysql2/promise');
      let testPool;
      if (config.database.url) {
        testPool = mysql2.createPool(config.database.url);
      } else {
        testPool = mysql2.createPool({
          host: config.database.host,
          user: config.database.user,
          password: config.database.password,
          database: config.database.database,
          port: config.database.port,
          connectTimeout: 5000,
        });
      }
      const conn = await testPool.getConnection();
      const [rows] = await conn.query('SELECT 1 as connected');
      conn.release();
      await testPool.end();
      connectionTest = { success: true, result: rows };
    } catch (err) {
      connectionTest = { success: false, error: err.message };
    }

    res.json({
      success: true,
      config: dbConfig,
      envKeys,
      dnsResults,
      connectionTest,
      isMemoryMode: db.isMemoryMode(),
      isInitialized: db.isInitialized()
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Temporary endpoint to inspect the cached DOM structure of the live scoreboard
app.get('/api/test-dom', async (req, res) => {
  try {
    const cheerio = require('cheerio');
    const htmlPath = path.join(__dirname, '../debug/live-page.html');
    if (!fs.existsSync(htmlPath)) {
      return res.status(404).json({ error: 'debug/live-page.html not found' });
    }
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const $ = cheerio.load(html);
    
    const results = {
      title: $('title').text().trim(),
      elements: []
    };
    
    $('*').each((i, el) => {
      const className = $(el).attr('class') || '';
      const id = $(el).attr('id') || '';
      if (className.includes('team') || className.includes('score') || className.includes('match') || className.includes('inning') || className.includes('innig') ||
          id.includes('team') || id.includes('score') || id.includes('match') || id.includes('inning')) {
        results.elements.push({
          tagName: el.tagName,
          class: className,
          id: id,
          textSnippet: $(el).text().trim().substring(0, 100).replace(/\s+/g, ' ')
        });
      }
    });

    // Also get the first 1000 characters of the body
    results.bodySnippet = $('body').text().trim().substring(0, 2000).replace(/\s+/g, ' ');

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// ============================================================
// ✅ BROADCAST API ENDPOINT
// ============================================================

app.post('/api/broadcast', async (req, res) => {
  try {
    const result = await scraperService.scrapeLive(true);

    if (result && result.success && result.data && result.data.length > 0) {
      if (wss) {
        const message = {
          type: 'live:update',
          data: {
            matches: result.data,
            count: result.data.length,
            timestamp: new Date().toISOString(),
          },
        };

        let clientsSent = 0;
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
            clientsSent++;
          }
        });

        logger.info(`📡 Broadcast ${result.data.length} live matches to ${clientsSent} clients`);

        const protocol = IS_HTTPS ? 'wss' : 'ws';
        res.json({
          success: true,
          message: `Broadcast ${result.data.length} live matches to ${clientsSent} clients`,
          clients: clientsSent,
          matches: result.data.length,
          timestamp: new Date().toISOString(),
          websocket: {
            url: `${protocol}://${req.get('host') || 'localhost'}/ws`,
            protocol: protocol,
          },
        });
      } else {
        res.json({
          success: false,
          error: 'WebSocket server not initialized',
          clients: 0,
        });
      }
    } else {
      res.json({
        success: false,
        error: result?.error || 'No matches to broadcast',
        matches: 0,
        clients: wss ? wss.clients.size : 0,
      });
    }
  } catch (error) {
    logger.error('Broadcast error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================
// ✅ WEBSOCKET STATUS ENDPOINT
// ============================================================

app.get('/api/ws-status', (req, res) => {
  const clients = wss ? wss.clients.size : 0;
  const protocol = IS_HTTPS ? 'wss' : 'ws';
  const host = req.get('host') || 'localhost';

  res.json({
    success: true,
    websocket: {
      enabled: wss !== null,
      clients: clients,
      path: '/ws',
      port: PORT,
      protocol: protocol,
      url: `${protocol}://${host}/ws`,
      secure: IS_HTTPS,
      autoDetect: true,
    },
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// ✅ TEST BROADCAST ENDPOINT
// ============================================================

app.post('/api/broadcast/test', async (req, res) => {
  try {
    const testMessage = {
      type: 'test',
      data: {
        message: 'Test broadcast message',
        timestamp: new Date().toISOString(),
      },
    };

    let clientsSent = 0;
    if (wss) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(testMessage));
          clientsSent++;
        }
      });
    }

    res.json({
      success: true,
      message: `Test message sent to ${clientsSent} clients`,
      clients: clientsSent,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================
// ✅ FORCE RELEASE LOCKS ENDPOINT
// ============================================================

app.post('/api/scrape/force-release', async (req, res) => {
  try {
    scraperService.forceReleaseLock('all');

    if (scraperService.crexScrapers && scraperService.crexScrapers.live) {
      if (typeof scraperService.crexScrapers.live.forceReleaseLock === 'function') {
        scraperService.crexScrapers.live.forceReleaseLock();
      }
    }

    res.json({
      success: true,
      message: 'All locks released successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================
// WEBSOCKET SERVER
// ============================================================

let server = null;
let wss = null;
const wsClients = new Map();
let broadcastInterval = null;

function broadcast(data, excludeClient = null) {
  if (!wss) return;
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
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

// ✅ REAL-TIME BROADCAST EVERY 5 SECONDS
async function startRealTimeBroadcast() {
  if (broadcastInterval) {
    clearInterval(broadcastInterval);
  }

  logger.info('🔄 Starting real-time broadcast every 5 seconds...');

  broadcastInterval = setInterval(async () => {
    try {
      // Force release any stuck locks
      if (scraperService.crexScrapers && scraperService.crexScrapers.live) {
        if (typeof scraperService.crexScrapers.live.ensureLockReleased === 'function') {
          await scraperService.crexScrapers.live.ensureLockReleased();
        }
      }

      const result = await scraperService.scrapeLive(true);
      if (
        result &&
        result.success &&
        result.data &&
        result.data.length > 0 &&
        wss &&
        wss.clients.size > 0
      ) {
        const message = {
          type: 'live:update',
          data: {
            matches: result.data,
            count: result.data.length,
            timestamp: new Date().toISOString(),
          },
        };

        let sent = 0;
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
            sent++;
          }
        });

        if (sent > 0) {
          logger.debug(`📡 Broadcast ${result.data.length} matches to ${sent} clients`);
        }
      }
    } catch (error) {
      logger.error('Broadcast error:', error.message);
    }
  }, 5000);
}

function setupWebSocket() {
  try {
    // ⭐ Create WebSocket server with auto-protocol detection
    wss = new WebSocket.Server({
      server,
      path: '/ws',
      clientTracking: true,
      maxPayload: 10 * 1024 * 1024,
      // ⭐ Handle upgrade with protocol detection
      handleProtocols: (protocols, request) => {
        // Check if client requested secure connection
        const isSecure =
          request.headers['x-forwarded-proto'] === 'https' ||
          request.headers['x-forwarded-ssl'] === 'on' ||
          request.headers['x-forwarded-protocol'] === 'https' ||
          IS_HTTPS;

        // Log the connection attempt
        logger.debug(`🔌 WebSocket connection attempt (Secure: ${isSecure})`);

        // Return the protocol that matches
        if (isSecure && protocols.has('wss')) {
          return 'wss';
        }
        if (protocols.has('ws')) {
          return 'ws';
        }
        // Default to the first available
        return protocols.values().next().value || 'ws';
      },
    });

    const protocol = IS_HTTPS ? 'wss' : 'ws';
    logger.info(`✅ WebSocket server initialized on ${protocol}://localhost:${PORT}/ws`);

    wss.on('connection', (ws, req) => {
      const clientId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const ip = req.socket.remoteAddress || 'unknown';

      // ⭐ Detect protocol from request
      const isSecure =
        req.headers['x-forwarded-proto'] === 'https' ||
        req.headers['x-forwarded-ssl'] === 'on' ||
        req.headers['x-forwarded-protocol'] === 'https' ||
        req.connection.encrypted ||
        IS_HTTPS;

      const protocol = isSecure ? 'wss' : 'ws';

      wsClients.set(clientId, {
        ws,
        ip,
        connectedAt: new Date(),
        subscriptions: new Set(['live']),
        protocol: protocol,
        secure: isSecure,
      });

      logger.info(`🔌 WebSocket client connected: ${clientId} (IP: ${ip}, Protocol: ${protocol})`);

      // ⭐ Send connection confirmation with protocol info
      sendToClient(ws, {
        type: 'connection',
        data: {
          clientId,
          timestamp: new Date().toISOString(),
          message: `Connected to Cricket Scraper WebSocket Server via ${protocol}`,
          serverTime: new Date().toISOString(),
          totalClients: wss.clients.size,
          protocol: protocol,
          secure: isSecure,
          reconnect: true,
          autoDetect: true,
        },
      });

      // ⭐ Send initial data immediately
      const sendInitialData = async () => {
        try {
          if (scraperService.crexScrapers && scraperService.crexScrapers.live) {
            if (typeof scraperService.crexScrapers.live.ensureLockReleased === 'function') {
              await scraperService.crexScrapers.live.ensureLockReleased();
            }
          }

          const result = await scraperService.scrapeLive(true);
          if (result && result.success && result.data && result.data.length > 0) {
            sendToClient(ws, {
              type: 'live:update',
              data: {
                matches: result.data,
                count: result.data.length,
                timestamp: new Date().toISOString(),
                protocol: protocol,
              },
            });
            logger.info(
              `📤 Sent initial ${result.data.length} matches to ${clientId} (${protocol})`
            );
          } else {
            sendToClient(ws, {
              type: 'live:update',
              data: {
                matches: [],
                count: 0,
                timestamp: new Date().toISOString(),
                protocol: protocol,
              },
            });
          }
        } catch (error) {
          logger.error('Error sending initial data:', error.message);
          sendToClient(ws, {
            type: 'error',
            data: {
              message: 'Failed to fetch initial data',
              error: error.message,
            },
          });
        }
      };

      // Send initial data after a small delay
      setTimeout(sendInitialData, 500);

      // ⭐ Message handler
      ws.on('message', async (message) => {
        try {
          const data =
            typeof message === 'string' ? JSON.parse(message) : JSON.parse(message.toString());
          await handleWebSocketMessage(ws, clientId, data);
        } catch (error) {
          logger.error(`WebSocket message error:`, error.message);
          sendToClient(ws, {
            type: 'error',
            data: {
              message: 'Invalid message format',
              error: error.message,
            },
          });
        }
      });

      // ⭐ Close handler
      ws.on('close', () => {
        logger.info(`🔌 WebSocket client disconnected: ${clientId}`);
        wsClients.delete(clientId);
      });

      // ⭐ Error handler
      ws.on('error', (error) => {
        logger.error(`WebSocket error for ${clientId}:`, error.message);
      });
    });

    wss.on('error', (error) => {
      logger.error('WebSocket server error:', error);
    });

    // Start real-time broadcast
    startRealTimeBroadcast();

    return true;
  } catch (error) {
    logger.error('Failed to initialize WebSocket server:', error);
    return false;
  }
}

// ============================================================
// WEBSOCKET MESSAGE HANDLER
// ============================================================

async function handleWebSocketMessage(ws, clientId, data) {
  const client = wsClients.get(clientId);
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
        data: {
          timestamp: new Date().toISOString(),
          protocol: client.protocol,
          secure: client.secure,
        },
      });
      break;

    case 'getLiveMatches':
      try {
        if (scraperService.crexScrapers && scraperService.crexScrapers.live) {
          if (typeof scraperService.crexScrapers.live.ensureLockReleased === 'function') {
            await scraperService.crexScrapers.live.ensureLockReleased();
          }
        }

        const result = await scraperService.scrapeLive(true);
        if (result && result.success && result.data) {
          sendToClient(ws, {
            type: 'live:update',
            data: {
              matches: result.data,
              count: result.data.length,
              timestamp: new Date().toISOString(),
              protocol: client.protocol,
            },
          });
        } else {
          sendToClient(ws, {
            type: 'live:update',
            data: {
              matches: [],
              count: 0,
              timestamp: new Date().toISOString(),
              protocol: client.protocol,
            },
          });
        }
      } catch (error) {
        logger.error('Error getting live matches:', error.message);
        sendToClient(ws, {
          type: 'error',
          data: {
            message: 'Failed to get live matches',
            error: error.message,
          },
        });
      }
      break;

    case 'forceScrape':
      try {
        sendToClient(ws, {
          type: 'scrape:start',
          data: {
            message: 'Force scraping started',
            type: payload?.type || 'live',
            timestamp: new Date().toISOString(),
          },
        });

        const result = await scraperService.forceScrape({
          type: payload?.type || 'live',
          forceRefresh: true,
        });

        if (result && result.success && result.data) {
          sendToClient(ws, {
            type: 'scrape:complete',
            data: {
              matches: result.data,
              count: result.data.length,
              message: 'Force scrape completed',
              timestamp: new Date().toISOString(),
            },
          });
        } else {
          sendToClient(ws, {
            type: 'scrape:error',
            data: {
              error: result?.error || 'Scrape failed',
            },
          });
        }
      } catch (error) {
        logger.error('Force scrape error:', error.message);
        sendToClient(ws, {
          type: 'scrape:error',
          data: {
            error: error.message,
          },
        });
      }
      break;

    default:
      sendToClient(ws, {
        type: 'error',
        data: {
          message: 'Unknown message type',
          type: type,
        },
      });
  }
}

function handleSubscribe(ws, clientId, payload) {
  const client = wsClients.get(clientId);
  if (!client) return;

  const topics = payload?.topics || ['live'];
  topics.forEach((topic) => {
    client.subscriptions.add(topic);
  });

  sendToClient(ws, {
    type: 'subscribed',
    data: {
      topics: topics,
      timestamp: new Date().toISOString(),
      protocol: client.protocol,
    },
  });

  logger.info(`📡 Client ${clientId} subscribed to: ${topics.join(', ')}`);
}

function handleUnsubscribe(ws, clientId, payload) {
  const client = wsClients.get(clientId);
  if (!client) return;

  const topics = payload?.topics || [];
  topics.forEach((topic) => {
    client.subscriptions.delete(topic);
  });

  sendToClient(ws, {
    type: 'unsubscribed',
    data: {
      topics: topics,
      timestamp: new Date().toISOString(),
    },
  });

  logger.info(`📡 Client ${clientId} unsubscribed from: ${topics.join(', ')}`);
}

// ============================================================
// API ROUTES
// ============================================================

app.use('/api', routes);

// ============================================================
// 404 HANDLER
// ============================================================

app.use((req, res) => {
  if (req.url === '/favicon.ico') {
    res.status(204).end();
    return;
  }
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
    if (broadcastInterval) {
      clearInterval(broadcastInterval);
      broadcastInterval = null;
    }

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

    logger.info('Cleaning up scrapers...');
    if (scraperService && typeof scraperService.cleanup === 'function') {
      await scraperService.cleanup();
    }

    logger.info('Closing browser...');
    if (browserManager && typeof browserManager.close === 'function') {
      await browserManager.close();
    }

    if (database && typeof database.close === 'function') {
      logger.info('Closing database connections...');
      await database.close();
    }

    if (cache && typeof cache.closeRedis === 'function') {
      logger.info('Closing cache connections...');
      await cache.closeRedis();
    }

    if (server) {
      logger.info('Closing HTTP server...');
      await new Promise((resolve) => {
        server.close(() => {
          logger.info('✅ HTTP server closed');
          resolve();
        });
      });
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

const initializeBrowser = async () => {
  try {
    logger.info('Initializing browser on startup...');
    if (browserManager && typeof browserManager.launch === 'function') {
      await browserManager.launch();
      logger.info('✅ Browser initialized successfully');
    }
  } catch (error) {
    logger.warn(
      '⚠️ Browser initialization failed on startup, will retry on demand:',
      error.message
    );
  }
};

// ============================================================
// START SERVER
// ============================================================

const startServer = () => {
  try {
    // ⭐ Create HTTP server
    server = http.createServer(app);

    // ⭐ Setup WebSocket
    const wsInitialized = setupWebSocket();
    if (!wsInitialized) {
      logger.warn('⚠️ WebSocket server failed to initialize, continuing without WebSocket support');
    }

    server.listen(PORT, async () => {
      const protocol = IS_HTTPS ? 'wss' : 'ws';
      const wsUrl = `${protocol}://localhost:${PORT}/ws`;

      logger.info('='.repeat(80));
      logger.info('🏏 CRICKET SCRAPER FRAMEWORK');
      logger.info('='.repeat(80));
      logger.info(`🚀 Server running on http://localhost:${PORT}`);
      logger.info(`🔌 WebSocket endpoint: ${wsUrl}`);
      logger.info(`📡 Real-time updates every 5 seconds`);
      logger.info(
        `🌍 Environment: ${NODE_ENV}${isProduction ? ' (PRODUCTION)' : ' (DEVELOPMENT)'}`
      );
      logger.info(`🔧 Node Version: ${process.version}`);
      logger.info(`🆔 Process ID: ${process.pid}`);
      logger.info(`💾 Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
      logger.info(`🔒 HTTPS: ${IS_HTTPS ? 'Enabled' : 'Disabled'}`);
      logger.info(`🔌 WebSocket Protocol: ${protocol}`);
      logger.info(`🔄 Auto-Detect: Client will automatically use ${protocol} based on page protocol`);
      logger.info(`📡 Health Check: http://localhost:${PORT}/health`);
      logger.info(`📊 Dashboard: http://localhost:${PORT}/web-test`);
      logger.info(`📡 Live API: http://localhost:${PORT}/api/live`);
      logger.info(`📡 Broadcast: http://localhost:${PORT}/api/broadcast`);
      logger.info(`📡 WebSocket Info: http://localhost:${PORT}/api/ws-info`);
      logger.info('='.repeat(80));

      logger.info('📋 Available Endpoints:');
      logger.info(`  GET  / - Dashboard`);
      logger.info(`  GET  /web-test - WebSocket Dashboard`);
      logger.info(`  GET  /health - Health check`);
      logger.info(`  GET  /api/live - Live matches API`);
      logger.info(`  POST /api/broadcast - Broadcast live matches to WebSocket clients`);
      logger.info(`  GET  /api/ws-status - WebSocket status`);
      logger.info(`  GET  /api/ws-info - WebSocket connection info with auto-detection`);
      logger.info(`  GET  /api/scrape/live - Scrape live matches`);
      logger.info(`  GET  /api/scrape/upcoming - Scrape upcoming matches`);
      logger.info(`  GET  /api/scrape/finished - Scrape finished matches`);
      logger.info(`  GET  /api/scrape/all - Scrape all matches`);
      logger.info(`  GET  /api/matches - Get matches from database`);
      logger.info(`  POST /api/cleanup - Cleanup hanging scrapers`);
      logger.info(`  POST /api/scrape/force-release - Force release locks`);
      logger.info('='.repeat(80));

      logger.info('📡 WebSocket Events:');
      logger.info(`  connection - Connection confirmation with protocol info`);
      logger.info(`  live:update - Live score updates (every 5 seconds)`);
      logger.info(`  live:new - New match started`);
      logger.info(`  live:complete - Match completed`);
      logger.info(`  match:update - Match data updated`);
      logger.info(`  score:update - Score updated`);
      logger.info(`  subscribed - Subscription confirmation`);
      logger.info(`  unsubscribed - Unsubscription confirmation`);
      logger.info(`  pong - Ping response`);
      logger.info(`  error - Error messages`);
      logger.info('='.repeat(80));

      logger.info('🔌 WebSocket Connection Help:');
      logger.info(`  Auto-detect: Use \`${protocol}\` based on page protocol`);
      logger.info(`  Manual: Connect to ${wsUrl}`);
      logger.info(`  Example: new WebSocket(\`\${window.location.protocol === 'https:' ? 'wss' : 'ws'}://\${window.location.host}/ws\`)`);
      logger.info('='.repeat(80));

      await initializeBrowser();
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

const initializeServices = async () => {
  try {
    logger.info('Initializing services...');

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
  }
};

const main = async () => {
  try {
    await initializeServices();
    startServer();

    // Run API comparison fetch and tail logs
    (async () => {
      try {
        const axios = require('axios');
        
        // Write the last 20k of app.log to debug/logs-end.txt
        try {
          const logPath = path.join(__dirname, '../logs/app.log');
          if (fs.existsSync(logPath)) {
            const stats = fs.statSync(logPath);
            const size = stats.size;
            const bytesToRead = Math.min(size, 20000);
            const startByte = Math.max(0, size - bytesToRead);
            const buffer = Buffer.alloc(bytesToRead);
            const fd = fs.openSync(logPath, 'r');
            fs.readSync(fd, buffer, 0, bytesToRead, startByte);
            fs.closeSync(fd);
            fs.writeFileSync(path.join(__dirname, '../debug/logs-end.txt'), buffer.toString('utf8'));
            logger.info('✅ [Comparison] Tailed app.log to debug/logs-end.txt');
          }
        } catch (err) {
          logger.error('❌ [Comparison] Failed to tail app.log:', err.message);
        }

        // Wait a few seconds for the local server to fully start up
        await new Promise(resolve => setTimeout(resolve, 5000));

        logger.info('🔍 [Comparison] Fetching Local API...');
        try {
          const localRes = await axios.get('http://localhost:3000/api/scrape/live');
          fs.writeFileSync(path.join(__dirname, '../debug/local-api-response.json'), JSON.stringify(localRes.data, null, 2));
          logger.info(`✅ [Comparison] Saved Local API response: ${localRes.data.total || 0} matches`);
        } catch (err) {
          logger.error('❌ [Comparison] Failed to fetch Local API:', err.message);
        }

        logger.info('🔍 [Comparison] Fetching Railway API...');
        try {
          const railwayRes = await axios.get('https://live-socre-production.up.railway.app/api/scrape/live');
          fs.writeFileSync(path.join(__dirname, '../debug/railway-api-response.json'), JSON.stringify(railwayRes.data, null, 2));
          logger.info(`✅ [Comparison] Saved Railway API response: ${railwayRes.data.total || 0} matches`);
        } catch (err) {
          logger.error('❌ [Comparison] Failed to fetch Railway API:', err.message);
        }
      } catch (err) {
        logger.error('[Comparison] General error:', err);
      }
    })();

  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
};

main();

// ⭐ Export for testing
module.exports = { app, server, wss };