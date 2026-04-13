const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');

const User = require('../models/User');
const { generateTokenPair, verifyRefreshToken } = require('../utils/jwt');
const { ApiError } = require('../utils/apiHelpers');
const { verifyFirebaseToken } = require('../config/firebase');
const emailService = require('./emailService');
const logger = require('../utils/logger');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const OTP_LENGTH        = 6;
const OTP_EXPIRY_MINS   = 10;
const OTP_BCRYPT_ROUNDS = 10;

// ─── Helper: generate a numeric OTP ──────────────────────────────────────────

const generateOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString(); // always 6 digits

// ─── FLOW 1: Phone + Firebase OTP ────────────────────────────────────────────

/**
 * Step 1 (client-side only):
 *   Client uses Firebase SDK to send OTP to the phone number.
 *   We have nothing to do server-side until the user submits the OTP.
 *
 * Step 2 — POST /auth/phone/verify
 *   Client sends the Firebase ID token obtained after the user enters the OTP.
 *   We verify the token server-side, then login or register the user.
 *
 * @param {string} phone          - E.164 phone number e.g. +919876543210
 * @param {string} firebaseIdToken - ID token from Firebase after OTP success
 */
const loginWithPhoneOTP = async ({ phone, firebaseIdToken }) => {
  // ── Verify Firebase token on the server ────────────────────────────────
  let decoded;
  try {
    decoded = await verifyFirebaseToken(firebaseIdToken);
  } catch {
    throw ApiError.unauthorized('OTP verification failed. The token is invalid or expired.');
  }

  // Cross-check phone number (Firebase embeds the verified phone in the token)
  if (decoded.phone_number && decoded.phone_number !== phone) {
    throw ApiError.unauthorized('Phone number does not match the OTP verification.');
  }

  // ── Find or create user ────────────────────────────────────────────────
  let user = await User.findOne({ $or: [{ phone }, { firebaseUid: decoded.uid }] });

  if (!user) {
    // First time — auto-register from phone number
    user = await User.create({
      username:        `user_${crypto.randomBytes(4).toString('hex')}`,
      phone,
      firebaseUid:     decoded.uid,
      isPhoneVerified: true,
    });
    logger.info(`New user registered via phone OTP: ${user._id} (${phone})`);
  } else {
    if (user.isBanned) throw ApiError.forbidden(`Account banned: ${user.banReason}`);

    // Keep firebaseUid and verified status up to date
    user.firebaseUid     = decoded.uid;
    user.isPhoneVerified = true;
    user.lastLoginAt     = new Date();
    await user.save({ validateBeforeSave: false });
  }

  const tokens = generateTokenPair(user);
  await _storeRefreshToken(user, tokens.refreshToken);

  return { user, tokens, isNewUser: !user.isEmailVerified && !user.email };
};

// ─── FLOW 2a: Email OTP — Send ────────────────────────────────────────────────

/**
 * Generate a 6-digit OTP, store its bcrypt hash on the user (or create the user
 * if they're registering for the first time), and email it.
 *
 * POST /auth/email/send-otp
 * Body: { email }
 */
const sendEmailOtp = async ({ email }) => {
  const otp     = generateOtp();
  const hash    = await bcrypt.hash(otp, OTP_BCRYPT_ROUNDS);
  const expires = new Date(Date.now() + OTP_EXPIRY_MINS * 60 * 1000);

  let user = await User.findOne({ email });

  if (!user) {
    // First visit — create a stub account; user completes profile after verification
    user = await User.create({
      username:        `user_${crypto.randomBytes(4).toString('hex')}`,
      email,
      emailOtpHash:    hash,
      emailOtpExpires: expires,
    });
    logger.info(`Stub account created for email OTP: ${email}`);
  } else {
    if (user.isBanned) throw ApiError.forbidden(`Account banned: ${user.banReason}`);

    // Update OTP hash on existing account
    await User.findByIdAndUpdate(user._id, {
      emailOtpHash:    hash,
      emailOtpExpires: expires,
    });
  }

  // Send OTP email (non-blocking — don't fail the API if email is slow)
  emailService.sendEmailOtp(user, otp).catch((err) =>
    logger.error(`Email OTP send failed for ${email}: ${err.message}`)
  );

  logger.info(`Email OTP sent to ${email} (expires in ${OTP_EXPIRY_MINS} min)`);

  // In development return the OTP so it can be tested without SMTP
  return process.env.NODE_ENV === 'development' ? { message: 'OTP sent', _devOtp: otp } : { message: 'OTP sent' };
};

// ─── FLOW 2b: Email OTP — Verify ─────────────────────────────────────────────

/**
 * Verify the 6-digit OTP the user submitted.
 * On success: mark email as verified, issue JWT pair.
 *
 * POST /auth/email/verify-otp
 * Body: { email, otp }
 */
const verifyEmailOtp = async ({ email, otp }) => {
  // Fetch the hidden OTP fields explicitly
  const user = await User.findOne({ email }).select('+emailOtpHash +emailOtpExpires');

  if (!user) throw ApiError.notFound('No account found for this email.');

  if (user.isBanned) throw ApiError.forbidden(`Account banned: ${user.banReason}`);

  if (!user.emailOtpHash || !user.emailOtpExpires) {
    throw ApiError.badRequest('No OTP was requested for this email. Please request a new OTP.');
  }

  if (user.emailOtpExpires < new Date()) {
    throw ApiError.badRequest('OTP has expired. Please request a new one.');
  }

  const isMatch = await bcrypt.compare(otp, user.emailOtpHash);
  if (!isMatch) {
    throw ApiError.unauthorized('Incorrect OTP. Please check and try again.');
  }

  // Clear OTP fields and mark email verified
  user.isEmailVerified = true;
  user.emailOtpHash    = undefined;
  user.emailOtpExpires = undefined;
  user.lastLoginAt     = new Date();
  await user.save({ validateBeforeSave: false });

  const tokens = generateTokenPair(user);
  await _storeRefreshToken(user, tokens.refreshToken);

  logger.info(`Email OTP verified and user logged in: ${user._id} (${email})`);

  return { user, tokens };
};

// ─── FLOW 3: Google OAuth ─────────────────────────────────────────────────────

/**
 * Login or register via Google.
 * Client obtains a Google ID token (using Firebase Auth or Google Sign-In SDK)
 * and sends it here for server-side verification.
 *
 * POST /auth/google
 * Body: { idToken }
 */
const loginWithGoogle = async ({ idToken }) => {
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw ApiError.unauthorized('Invalid Google ID token.');
  }

  const { sub: googleId, email, name, picture, email_verified } = payload;

  if (!email_verified) {
    throw ApiError.badRequest('Google account email is not verified.');
  }

  let user = await User.findOne({ $or: [{ googleId }, { email }] });

  if (!user) {
    // Auto-register from Google profile
    user = await User.create({
      username:        (name || '').replace(/\s+/g, '_').slice(0, 30) ||
                       `google_${crypto.randomBytes(4).toString('hex')}`,
      email,
      googleId,
      isEmailVerified: true,
      profilePicture:  { url: picture || '', publicId: '' },
    });
    logger.info(`New user registered via Google OAuth: ${user._id} (${email})`);
  } else {
    if (user.isBanned) throw ApiError.forbidden(`Account banned: ${user.banReason}`);

    // Link Google account if not already linked
    if (!user.googleId) user.googleId = googleId;
    user.isEmailVerified = true;
    user.lastLoginAt     = new Date();
    await user.save({ validateBeforeSave: false });
  }

  const tokens = generateTokenPair(user);
  await _storeRefreshToken(user, tokens.refreshToken);

  return { user, tokens };
};

// ─── Token Refresh ────────────────────────────────────────────────────────────

/**
 * Rotate the token pair using a valid refresh token.
 * Detects reuse (if hash doesn't match → stolen token → reject).
 */
const refreshTokens = async (incomingRefreshToken) => {
  const decoded = verifyRefreshToken(incomingRefreshToken);

  const user = await User.findById(decoded.userId).select('+refreshToken');
  if (!user || !user.refreshToken) {
    throw ApiError.unauthorized('Invalid refresh token.');
  }

  const hash = crypto.createHash('sha256').update(incomingRefreshToken).digest('hex');
  if (hash !== user.refreshToken) {
    // Token reuse detected — invalidate all sessions
    await User.findByIdAndUpdate(decoded.userId, { $unset: { refreshToken: 1 } });
    throw ApiError.unauthorized('Refresh token reuse detected. Please log in again.');
  }

  const tokens = generateTokenPair(user);
  await _storeRefreshToken(user, tokens.refreshToken);

  return { tokens };
};

// ─── Logout ───────────────────────────────────────────────────────────────────

const logout = async (userId) => {
  await User.findByIdAndUpdate(userId, { $unset: { refreshToken: 1 } });
  logger.info(`User logged out: ${userId}`);
};

// ─── Complete Profile (after first login) ────────────────────────────────────

/**
 * After phone OTP auto-registration the user has a generated username and no email.
 * This endpoint lets them complete their profile.
 *
 * PATCH /auth/complete-profile
 * Body: { username, email? }  (email triggers an email OTP flow)
 */
const completeProfile = async (userId, { username, email }) => {
  const updates = {};

  if (username) {
    // Check uniqueness
    const taken = await User.findOne({ username, _id: { $ne: userId } });
    if (taken) throw ApiError.conflict('Username is already taken.');
    updates.username = username;
  }

  if (email) {
    const taken = await User.findOne({ email, _id: { $ne: userId } });
    if (taken) throw ApiError.conflict('Email is already associated with another account.');
    updates.email            = email.toLowerCase().trim();
    updates.isEmailVerified  = false; // will be verified via email OTP
  }

  const user = await User.findByIdAndUpdate(userId, updates, { new: true, runValidators: true });
  return user;
};

// ─── Private: store hashed refresh token ─────────────────────────────────────

const _storeRefreshToken = async (user, refreshToken) => {
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await User.findByIdAndUpdate(user._id, { refreshToken: hash });
};

module.exports = {
  loginWithPhoneOTP,
  sendEmailOtp,
  verifyEmailOtp,
  loginWithGoogle,
  refreshTokens,
  logout,
  completeProfile,
};