const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/jwt');
const chatService = require('../services/chatService');
const logger = require('../utils/logger');

/**
 * Initialize Socket.io on the HTTP server.
 * Exports the io instance so it can be used elsewhere (e.g., controllers).
 *
 * @param {http.Server} httpServer
 * @returns {Server} io
 */
const initializeSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ── Socket.io JWT Middleware ──────────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];

    if (!token) {
      return next(new Error('Authentication token missing'));
    }

    try {
      const decoded = verifyAccessToken(token);
      socket.userId = decoded.userId;
      socket.userRole = decoded.role;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  // ── Track online users: Map<userId, Set<socketId>> ────────────────────────
  const onlineUsers = new Map();

  const addOnlineUser = (userId, socketId) => {
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socketId);
  };

  const removeOnlineUser = (userId, socketId) => {
    if (onlineUsers.has(userId)) {
      onlineUsers.get(userId).delete(socketId);
      if (onlineUsers.get(userId).size === 0) onlineUsers.delete(userId);
    }
  };

  const isUserOnline = (userId) => onlineUsers.has(userId.toString());

  // ── Connection Handler ────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const { userId } = socket;
    logger.info(`Socket connected: ${socket.id} (user: ${userId})`);

    addOnlineUser(userId, socket.id);

    // Broadcast presence to other users who care
    socket.broadcast.emit('user:online', { userId });

    // ── Join a chat room ────────────────────────────────────────────────────
    socket.on('chat:join', async (chatId) => {
      try {
        // Verify the user belongs to this chat before joining
        const { Chat } = require('../models/Chat');
        const chat = await Chat.findById(chatId);
        if (!chat) return socket.emit('error', { message: 'Chat not found' });

        const isParticipant =
          chat.buyer.toString() === userId || chat.seller.toString() === userId;

        if (!isParticipant) {
          return socket.emit('error', { message: 'Not authorized to join this chat' });
        }

        socket.join(`chat:${chatId}`);
        socket.emit('chat:joined', { chatId });
        logger.debug(`User ${userId} joined chat room: ${chatId}`);

        // Notify other participant that this user is in the room
        socket.to(`chat:${chatId}`).emit('chat:participant_joined', { userId, chatId });
      } catch (err) {
        logger.error(`chat:join error: ${err.message}`);
        socket.emit('error', { message: 'Failed to join chat' });
      }
    });

    // ── Leave a chat room ───────────────────────────────────────────────────
    socket.on('chat:leave', (chatId) => {
      socket.leave(`chat:${chatId}`);
      socket.to(`chat:${chatId}`).emit('chat:participant_left', { userId, chatId });
      logger.debug(`User ${userId} left chat room: ${chatId}`);
    });

    // ── Send a message ──────────────────────────────────────────────────────
    socket.on('message:send', async (data) => {
      const { chatId, text, type = 'text', offerAmount } = data;

      if (!chatId) {
        return socket.emit('error', { message: 'chatId is required' });
      }
      if (type === 'text' && (!text || text.trim().length === 0)) {
        return socket.emit('error', { message: 'Message text cannot be empty' });
      }
      if (text && text.length > 1000) {
        return socket.emit('error', { message: 'Message too long (max 1000 characters)' });
      }

      try {
        const message = await chatService.saveMessage(chatId, userId, {
          text: text?.trim(),
          type,
          offerAmount,
        });

        // Emit to all users in the chat room (including sender for confirmation)
        io.to(`chat:${chatId}`).emit('message:new', { message });

        // If recipient is online but not in the room, send a notification
        const { Chat } = require('../models/Chat');
        const chat = await Chat.findById(chatId);
        if (chat) {
          const recipientId = chat.buyer.toString() === userId
            ? chat.seller.toString()
            : chat.buyer.toString();

          if (isUserOnline(recipientId)) {
            io.to(`user:${recipientId}`).emit('notification:new_message', {
              chatId,
              senderId: userId,
              preview: text?.slice(0, 60) || (type === 'image' ? '📷 Image' : `Offer: ₹${offerAmount}`),
            });

            // Auto-mark as delivered if recipient is online
            await chatService.updateMessageStatus(message._id, 'delivered');
            io.to(`chat:${chatId}`).emit('message:status', {
              messageId: message._id,
              status: 'delivered',
            });
          }
        }
      } catch (err) {
        logger.error(`message:send error for user ${userId}: ${err.message}`);
        socket.emit('error', { message: err.message || 'Failed to send message' });
      }
    });

    // ── Mark messages as read ───────────────────────────────────────────────
    socket.on('message:read', async ({ chatId, messageId }) => {
      try {
        await chatService.updateMessageStatus(messageId, 'read');

        // Notify the sender that their message was read
        io.to(`chat:${chatId}`).emit('message:status', {
          messageId,
          status: 'read',
          readAt: new Date(),
        });
      } catch (err) {
        logger.error(`message:read error: ${err.message}`);
      }
    });

    // ── Typing indicators ───────────────────────────────────────────────────
    socket.on('typing:start', ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit('typing:started', { userId, chatId });
    });

    socket.on('typing:stop', ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit('typing:stopped', { userId, chatId });
    });

    // ── Join personal room (for direct notifications) ─────────────────────
    socket.join(`user:${userId}`);

    // ── Check if a specific user is online ──────────────────────────────────
    socket.on('user:check_online', ({ targetUserId }) => {
      socket.emit('user:online_status', {
        userId: targetUserId,
        isOnline: isUserOnline(targetUserId),
      });
    });

    // ── Disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      removeOnlineUser(userId, socket.id);

      // Only broadcast offline if user has no other active sockets
      if (!isUserOnline(userId)) {
        socket.broadcast.emit('user:offline', { userId });
      }

      logger.info(`Socket disconnected: ${socket.id} (user: ${userId}) — ${reason}`);
    });

    // ── Error handler ───────────────────────────────────────────────────────
    socket.on('error', (err) => {
      logger.error(`Socket error for user ${userId}: ${err.message}`);
    });
  });

  logger.info('Socket.io initialized');
  return io;
};

module.exports = { initializeSocket };