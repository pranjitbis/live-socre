const { Server } = require('socket.io');
const logger = require('../logger');
const config = require('../config');
const { cache } = require('../cache');

let io = null;
const clients = new Map();

function setupWebSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingInterval: config.websocket.pingInterval || 30000,
    pingTimeout: config.websocket.pingTimeout || 5000,
  });

  io.on('connection', (socket) => {
    logger.info(`WebSocket client connected: ${socket.id}`);

    clients.set(socket.id, {
      id: socket.id,
      connectedAt: new Date(),
      subscriptions: new Set(),
      ip: socket.handshake.address,
    });

    sendInitialData(socket);

    socket.on('subscribe', (channels) => {
      const client = clients.get(socket.id);
      if (!client) return;

      const subscribed = [];
      channels.forEach((channel) => {
        if (['live_score', 'commentary', 'fixtures', 'points_table', 'news'].includes(channel)) {
          client.subscriptions.add(channel);
          subscribed.push(channel);
        }
      });

      socket.emit('subscribed', {
        channels: subscribed,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('unsubscribe', (channels) => {
      const client = clients.get(socket.id);
      if (!client) return;

      channels.forEach((channel) => {
        client.subscriptions.delete(channel);
      });

      socket.emit('unsubscribed', {
        channels,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('ping', (data) => {
      socket.emit('pong', {
        timestamp: new Date().toISOString(),
        client: data?.timestamp,
      });
    });

    socket.on('disconnect', () => {
      clients.delete(socket.id);
      logger.info(`WebSocket client disconnected: ${socket.id}`);
    });
  });

  logger.info('WebSocket server initialized');
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
    });
  });
}

function broadcastToChannel(channel, data) {
  if (!io) return;

  const payload = {
    data,
    timestamp: new Date().toISOString(),
  };

  io.emit(channel, payload);
  io.emit('update', {
    channel,
    data,
    timestamp: new Date().toISOString(),
  });
}

function getConnectedClients() {
  return {
    total: clients.size,
    details: Array.from(clients.values()).map((c) => ({
      id: c.id,
      connectedAt: c.connectedAt,
      subscriptions: Array.from(c.subscriptions),
    })),
  };
}

module.exports = {
  setupWebSocket,
  broadcastToChannel,
  getConnectedClients,
  io: () => io,
};
