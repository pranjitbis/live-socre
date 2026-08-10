// src/websocket/index.js
const { Server } = require('socket.io');
const logger = require('../logger');
const config = require('../config');
const { cache } = require('../cache');

let io = null;
const clients = new Map();
const IS_HTTPS = process.env.USE_HTTPS === 'true' || 
                 process.env.NODE_ENV === 'production' ||
                 process.env.RAILWAY_ENVIRONMENT === 'production';

function setupWebSocket(server) {
  // ⭐ Auto-detect protocol based on environment
  const isSecure = IS_HTTPS || process.env.RAILWAY_ENVIRONMENT === 'production';
  const protocol = isSecure ? 'wss' : 'ws';
  
  logger.info(`🔌 WebSocket protocol: ${protocol} (Secure: ${isSecure})`);
  
  // ⭐ Socket.IO with CORS configuration
  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
      methods: ['GET', 'POST'],
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    },
    pingInterval: config.websocket?.pingInterval || 30000,
    pingTimeout: config.websocket?.pingTimeout || 5000,
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    // ⭐ Force secure connections in production
    secure: isSecure,
    // ⭐ Protocol detection
    allowUpgrades: true,
    upgradeTimeout: 10000,
  });

  // ⭐ Log connection attempts
  io.engine.on('connection', (socket) => {
    const isSecureConnection = socket.request.connection.encrypted || 
                               socket.request.headers['x-forwarded-proto'] === 'https';
    logger.debug(`🔌 Socket.IO connection attempt (Secure: ${isSecureConnection})`);
  });

  io.on('connection', (socket) => {
    // ⭐ Detect if connection is secure
    const isSecure = socket.request.connection.encrypted || 
                     socket.request.headers['x-forwarded-proto'] === 'https';
    const protocol = isSecure ? 'wss' : 'ws';
    
    logger.info(`🔌 Socket.IO client connected: ${socket.id} (Protocol: ${protocol})`);

    clients.set(socket.id, {
      id: socket.id,
      connectedAt: new Date(),
      subscriptions: new Set(),
      ip: socket.handshake.address,
      protocol: protocol,
      secure: isSecure,
    });

    // ⭐ Send connection info with protocol
    socket.emit('connection:info', {
      clientId: socket.id,
      protocol: protocol,
      secure: isSecure,
      timestamp: new Date().toISOString(),
      message: `Connected via ${protocol} (${isSecure ? 'Secure' : 'Insecure'})`,
      reconnect: true,
    });

    // Send initial data
    sendInitialData(socket);

    // ⭐ Subscribe handler
    socket.on('subscribe', (channels) => {
      const client = clients.get(socket.id);
      if (!client) return;

      const subscribed = [];
      const validChannels = ['live_score', 'commentary', 'fixtures', 'points_table', 'news', 'live'];
      
      const channelArray = Array.isArray(channels) ? channels : [channels];
      channelArray.forEach((channel) => {
        if (validChannels.includes(channel)) {
          client.subscriptions.add(channel);
          subscribed.push(channel);
        }
      });

      socket.emit('subscribed', {
        channels: subscribed,
        timestamp: new Date().toISOString(),
        protocol: client.protocol,
      });
      
      logger.info(`📡 Client ${socket.id} subscribed to: ${subscribed.join(', ')}`);
    });

    // ⭐ Unsubscribe handler
    socket.on('unsubscribe', (channels) => {
      const client = clients.get(socket.id);
      if (!client) return;

      const channelArray = Array.isArray(channels) ? channels : [channels];
      channelArray.forEach((channel) => {
        client.subscriptions.delete(channel);
      });

      socket.emit('unsubscribed', {
        channels: channelArray,
        timestamp: new Date().toISOString(),
      });
    });

    // ⭐ Ping handler
    socket.on('ping', (data) => {
      socket.emit('pong', {
        timestamp: new Date().toISOString(),
        client: data?.timestamp,
        serverTime: new Date().toISOString(),
        protocol: clients.get(socket.id)?.protocol,
      });
    });

    // ⭐ Get live matches
    socket.on('getLiveMatches', async () => {
      try {
        const { scraperService } = require('../services/scraperService');
        const result = await scraperService.scrapeLive(true);
        
        if (result && result.success && result.data) {
          socket.emit('live:update', {
            data: {
              matches: result.data,
              count: result.data.length,
              timestamp: new Date().toISOString(),
            },
          });
        }
      } catch (error) {
        logger.error('Error getting live matches:', error.message);
        socket.emit('error', {
          message: 'Failed to get live matches',
          error: error.message,
        });
      }
    });

    // ⭐ Force scrape
    socket.on('forceScrape', async (payload) => {
      try {
        socket.emit('scrape:start', {
          message: 'Force scraping started',
          type: payload?.type || 'live',
          timestamp: new Date().toISOString(),
        });
        
        const { scraperService } = require('../services/scraperService');
        const result = await scraperService.forceScrape({
          type: payload?.type || 'live',
          forceRefresh: true,
        });
        
        if (result && result.success && result.data) {
          socket.emit('scrape:complete', {
            matches: result.data,
            count: result.data.length,
            message: 'Force scrape completed',
            timestamp: new Date().toISOString(),
          });
        } else {
          socket.emit('scrape:error', {
            error: result?.error || 'Scrape failed',
          });
        }
      } catch (error) {
        logger.error('Force scrape error:', error.message);
        socket.emit('scrape:error', {
          error: error.message,
        });
      }
    });

    // ⭐ Disconnect handler
    socket.on('disconnect', () => {
      const client = clients.get(socket.id);
      if (client) {
        logger.info(`🔌 Socket.IO client disconnected: ${socket.id} (Protocol: ${client.protocol})`);
      } else {
        logger.info(`🔌 Socket.IO client disconnected: ${socket.id}`);
      }
      clients.delete(socket.id);
    });

    // ⭐ Error handler
    socket.on('error', (error) => {
      logger.error(`Socket.IO error for ${socket.id}:`, error.message);
    });
  });

  // ⭐ Handle server errors
  io.on('error', (error) => {
    logger.error('Socket.IO server error:', error.message);
  });

  logger.info(`✅ WebSocket (Socket.IO) server initialized (Protocol: ${protocol})`);
  return io;
}

function sendInitialData(socket) {
  const channels = ['live_score', 'fixtures', 'points_table', 'news'];

  channels.forEach((channel) => {
    const key = channel === 'live_score' ? 'live_matches' : channel;
    cache.get(key).then((data) => {
      if (data) {
        socket.emit(channel, {
          data,
          timestamp: new Date().toISOString(),
        });
      }
    }).catch((error) => {
      logger.debug(`Failed to get cached data for ${channel}:`, error.message);
    });
  });
}

function broadcastToChannel(channel, data) {
  if (!io) {
    logger.warn('⚠️ Cannot broadcast - Socket.IO not initialized');
    return;
  }

  const payload = {
    data,
    timestamp: new Date().toISOString(),
  };

  // ⭐ Broadcast to specific channel
  io.emit(channel, payload);
  
  // ⭐ Also send generic update
  io.emit('update', {
    channel,
    data,
    timestamp: new Date().toISOString(),
  });
  
  logger.debug(`📡 Broadcast to channel "${channel}"`);
}

function broadcastToAll(data) {
  if (!io) return;
  
  io.emit('broadcast', {
    data,
    timestamp: new Date().toISOString(),
  });
}

function getConnectedClients() {
  const clientsList = Array.from(clients.values()).map((c) => ({
    id: c.id,
    connectedAt: c.connectedAt,
    subscriptions: Array.from(c.subscriptions),
    ip: c.ip,
    protocol: c.protocol || 'unknown',
    secure: c.secure || false,
  }));
  
  return {
    total: clients.size,
    details: clientsList,
  };
}

function getConnectionInfo() {
  const isSecure = IS_HTTPS || process.env.RAILWAY_ENVIRONMENT === 'production';
  const protocol = isSecure ? 'wss' : 'ws';
  
  return {
    protocol: protocol,
    secure: isSecure,
    clients: clients.size,
    ready: io !== null,
    timestamp: new Date().toISOString(),
    url: `${protocol}://${process.env.HOST || 'localhost'}:${process.env.PORT || 3000}`,
  };
}

function forceReleaseLock() {
  // Force release all connections if needed
  if (io) {
    // Get all sockets and force disconnect if needed
    const sockets = io.sockets.sockets;
    let count = 0;
    for (const [id, socket] of sockets) {
      if (socket && socket.connected) {
        count++;
      }
    }
    logger.info(`🔓 Force released ${count} Socket.IO connections`);
    return count;
  }
  return 0;
}

module.exports = {
  setupWebSocket,
  broadcastToChannel,
  broadcastToAll,
  getConnectedClients,
  getConnectionInfo,
  forceReleaseLock,
  io: () => io,
};