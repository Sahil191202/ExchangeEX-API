const express = require('express');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

// Tight rate limit for all auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,                                           // 15 min window
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 10,
  message: { success: false, message: 'Too many attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Extra-tight limit for OTP send (prevent OTP spam / SMS abuse)
const otpSendLimiter = rateLimit({
  windowMs: 60 * 1000,     // 1 minute
  max: 3,                  // max 3 OTP requests per minute per IP
  message: { success: false, message: 'Too many OTP requests. Please wait a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Phone OTP (Firebase) ─────────────────────────────────────────────────────
// Step 1 is entirely client-side (Firebase SDK sends the SMS).
// Step 2: client sends the Firebase ID token here after user enters OTP.
router.post(
  '/phone/verify',
  authLimiter,
  validate(schemas.phoneOtpSchema),
  authController.phoneVerify
);

// ─── Email OTP ────────────────────────────────────────────────────────────────
router.post(
  '/email/send-otp',
  otpSendLimiter,
  validate(schemas.emailSendOtpSchema),
  authController.emailSendOtp
);

router.post(
  '/email/verify-otp',
  authLimiter,
  validate(schemas.emailVerifyOtpSchema),
  authController.emailVerifyOtp
);

// ─── Google OAuth ─────────────────────────────────────────────────────────────
router.post(
  '/google',
  authLimiter,
  validate(schemas.googleOAuthSchema),
  authController.googleLogin
);

// ─── Token management ─────────────────────────────────────────────────────────
router.post(
  '/refresh',
  authLimiter,
  validate(schemas.refreshTokenSchema),
  authController.refreshToken
);

// ─── Protected ────────────────────────────────────────────────────────────────
router.post('/logout',            authenticate, authController.logout);
router.get('/me',                 authenticate, authController.getMe);
router.patch(
  '/complete-profile',
  authenticate,
  validate(schemas.completeProfileSchema),
  authController.completeProfile
);

module.exports = router;