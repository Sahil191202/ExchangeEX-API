const mongoose = require('mongoose');
const logger = require('../utils/logger');

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

/**
 * Connect to MongoDB with automatic retry on failure.
 * Uses Mongoose connection pooling (maxPoolSize: 10).
 */
const connectDB = async (retryCount = 0) => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 10,       // max simultaneous connections
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    logger.info(`MongoDB connected: ${conn.connection.host}`);

    // Graceful shutdown on SIGINT
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed on app termination');
      process.exit(0);
    });

  } catch (error) {
    logger.error(`MongoDB connection error: ${error.message}`);

    if (retryCount < MAX_RETRIES) {
      logger.info(`Retrying connection in ${RETRY_DELAY_MS / 1000}s... (${retryCount + 1}/${MAX_RETRIES})`);
      await new Promise(res => setTimeout(res, RETRY_DELAY_MS));
      return connectDB(retryCount + 1);
    }

    logger.error('Max connection retries reached. Exiting.');
    process.exit(1);
  }
};

module.exports = connectDB;