const { ApiError } = require('../utils/apiHelpers');
const logger = require('../utils/logger');

/**
 * Global Error Handler Middleware
 * Must be registered LAST in Express app (after all routes).
 *
 * Handles:
 *   - ApiError (our custom errors)
 *   - Mongoose validation errors
 *   - Mongoose duplicate key errors
 *   - Mongoose CastError (invalid ObjectId)
 *   - JWT errors
 *   - Multer errors
 *   - Generic unhandled errors
 */
const errorHandler = (err, req, res, next) => {
  let error = err;

  // ─── Mongoose: invalid ObjectId ───────────────────────────────────────────
  if (err.name === 'CastError') {
    error = ApiError.badRequest(`Invalid ${err.path}: ${err.value}`);
  }

  // ─── Mongoose: duplicate key ──────────────────────────────────────────────
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const value = err.keyValue[field];
    error = ApiError.conflict(`${field} '${value}' already exists`);
  }

  // ─── Mongoose: validation error ───────────────────────────────────────────
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    error = ApiError.badRequest('Validation failed', errors);
  }

  // ─── JWT errors ───────────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError') {
    error = ApiError.unauthorized('Invalid token');
  }

  if (err.name === 'TokenExpiredError') {
    error = ApiError.unauthorized('Token has expired');
  }

  // ─── Multer: file upload errors ───────────────────────────────────────────
  if (err.code === 'LIMIT_FILE_SIZE') {
    error = ApiError.badRequest('File size exceeds the allowed limit');
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    error = ApiError.badRequest('Too many files uploaded');
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    error = ApiError.badRequest(`Unexpected file field: ${err.field}`);
  }

  // ─── If it's still not an ApiError, wrap it ───────────────────────────────
  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || 500;
    const message =
      process.env.NODE_ENV === 'production' && statusCode === 500
        ? 'Internal server error'
        : error.message || 'Internal server error';

    error = new ApiError(statusCode, message, error.errors || []);
  }

  // ─── Log server errors ────────────────────────────────────────────────────
  if (error.statusCode >= 500) {
    logger.error({
      message: error.message,
      statusCode: error.statusCode,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userId: req.user?._id,
    });
  } else {
    // Log 4xx at debug level (expected client errors, not worth alerting)
    logger.debug(`[${error.statusCode}] ${req.method} ${req.originalUrl} — ${error.message}`);
  }

  // ─── Send response ────────────────────────────────────────────────────────
  res.status(error.statusCode).json({
    success: false,
    statusCode: error.statusCode,
    message: error.message,
    errors: error.errors?.length ? error.errors : undefined,
    // Only include stack trace in development
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

/**
 * 404 handler — catches requests that don't match any route.
 * Register this BEFORE the errorHandler but AFTER all routes.
 */
const notFoundHandler = (req, res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
};

module.exports = { errorHandler, notFoundHandler };