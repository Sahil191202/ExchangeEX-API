const jwt = require('jsonwebtoken');
const { ApiError } = require('./apiHelpers');

/**
 * Generate a short-lived access token.
 * @param {object} payload - Data to embed (userId, role)
 * @returns {string} JWT access token
 */
const generateAccessToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    issuer: 'olx-platform',
    audience: 'olx-client',
  });
};

/**
 * Generate a long-lived refresh token.
 * @param {object} payload - Minimal payload (userId only recommended)
 * @returns {string} JWT refresh token
 */
const generateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    issuer: 'olx-platform',
    audience: 'olx-client',
  });
};

/**
 * Verify an access token.
 * @param {string} token
 * @returns {object} Decoded payload
 * @throws {ApiError} 401 if invalid or expired
 */
const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'olx-platform',
      audience: 'olx-client',
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Access token expired');
    }
    throw ApiError.unauthorized('Invalid access token');
  }
};

/**
 * Verify a refresh token.
 * @param {string} token
 * @returns {object} Decoded payload
 * @throws {ApiError} 401 if invalid or expired
 */
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET, {
      issuer: 'olx-platform',
      audience: 'olx-client',
    });
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }
};

/**
 * Generate both access and refresh tokens for a user.
 * @param {object} user - Mongoose user document
 * @returns {{ accessToken, refreshToken }}
 */
const generateTokenPair = (user) => {
  const payload = {
    userId: user._id.toString(),
    role: user.role,
  };

  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken({ userId: payload.userId }),
  };
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateTokenPair,
};