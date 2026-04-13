const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const rateLimit = require('express-rate-limit');

// Strict rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 10,
  message: { success: false, message: 'Too many auth attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Public Routes ────────────────────────────────────────────────────────────
router.post('/register',    authLimiter, validate(schemas.registerSchema),    authController.register);
router.post('/login',       authLimiter, validate(schemas.loginSchema),        authController.login);
router.post('/phone-login', authLimiter, validate(schemas.phoneOtpSchema),     authController.phoneLogin);
router.post('/google',      authLimiter, validate(schemas.googleOAuthSchema),  authController.googleLogin);
router.post('/refresh',     authLimiter, validate(schemas.refreshTokenSchema), authController.refreshToken);
router.get('/verify-email',              authController.verifyEmail);

// ─── Protected Routes ─────────────────────────────────────────────────────────
router.post('/logout', authenticate, authController.logout);
router.get('/me',      authenticate, authController.getMe);

module.exports = router;