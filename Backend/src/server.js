require('dotenv').config();

const http = require('http');
const app = require('./app');
const connectDB = require('./config/database');
const { initializeFirebase } = require('./config/firebase');
const { initializeSocket } = require('./socket/socketServer');
const logger = require('./utils/logger');

const PORT = parseInt(process.env.PORT, 10) || 5000;

/**
 * Boot sequence:
 * 1. Connect to MongoDB
 * 2. Initialize Firebase Admin SDK
 * 3. Create HTTP server from Express app
 * 4. Attach Socket.io to the HTTP server
 * 5. Start listening
 */
const startServer = async () => {
  try {
    // Step 1: Database
    await connectDB();

    // Step 2: Firebase (non-critical — don't crash if misconfigured in dev)
    try {
      initializeFirebase();
    } catch (firebaseErr) {
      logger.warn(`Firebase init skipped: ${firebaseErr.message}`);
    }

    // Step 3: HTTP Server
    const httpServer = http.createServer(app);

    // Step 4: Socket.io
    const io = initializeSocket(httpServer);

    // Make io accessible in controllers if needed (via app.locals)
    app.locals.io = io;

    // Step 5: Listen
    httpServer.listen(PORT, () => {
      logger.info(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  OLX Platform API — ${process.env.NODE_ENV?.toUpperCase()} mode
  HTTP  : http://localhost:${PORT}
  Health: http://localhost:${PORT}/api/health
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      `);
    });

    // ── Graceful shutdown ──────────────────────────────────────────────────
    const shutdown = async (signal) => {
      logger.info(`${signal} received. Starting graceful shutdown...`);

      httpServer.close(async () => {
        logger.info('HTTP server closed');

        const mongoose = require('mongoose');
        await mongoose.connection.close();
        logger.info('MongoDB connection closed');

        process.exit(0);
      });

      // Force kill if shutdown takes too long
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

    // ── Unhandled errors ───────────────────────────────────────────────────
    process.on('uncaughtException', (err) => {
      logger.error(`Uncaught Exception: ${err.message}`, { stack: err.stack });
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error(`Unhandled Rejection: ${reason}`);
      process.exit(1);
    });

  } catch (err) {
    logger.error(`Server startup failed: ${err.message}`);
    process.exit(1);
  }
};

startServer();