const crypto = require('crypto');
const User = require('../models/User');
const { generateTokenPair, verifyRefreshToken } = require('../utils/jwt');
const { ApiError } = require('../utils/apiHelpers');
const { verifyFirebaseToken } = require('../config/firebase');
const { OAuth2Client } = require('google-auth-library');
const emailService = require('./emailService');
const logger = require('../utils/logger');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register a new user with email + password.
 * Sends a verification email on success.
 */
const registerWithEmail = async ({ username, email, phone, password }) => {
  // Check for existing user
  const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
  if (existingUser) {
    if (existingUser.email === email) {
      throw ApiError.conflict('An account with this email already exists');
    }
    if (existingUser.phone === phone) {
      throw ApiError.conflict('An account with this phone number already exists');
    }
  }

  // Generate email verification token
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  const user = await User.create({
    username,
    email,
    phone,
    password, // will be hashed by pre-save hook
    emailVerificationToken: crypto.createHash('sha256').update(verificationToken).digest('hex'),
    emailVerificationExpires: verificationExpires,
  });

  // Send verification email (non-blocking — don't fail registration if email fails)
  emailService.sendVerificationEmail(user, verificationToken).catch((err) => {
    logger.error(`Verification email failed for ${email}: ${err.message}`);
  });

  const tokens = generateTokenPair(user);
  await _storeRefreshToken(user, tokens.refreshToken);

  logger.info(`New user registered: ${user._id} (${email})`);

  return { user, tokens };
};

// ─── Email/Password Login ──────────────────────────────────────────────────────

/**
 * Login with email (or phone) + password.
 */
const loginWithPassword = async ({ email, phone, password }) => {
  const query = email ? { email } : { phone };

  // Explicitly select password (excluded by default in schema)
  const user = await User.findOne(query).select('+password');
  if (!user || !user.password) {
    throw ApiError.unauthorized('Invalid credentials');
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw ApiError.unauthorized('Invalid credentials');
  }

  if (user.isBanned) {
    throw ApiError.forbidden(`Account banned: ${user.banReason}`);
  }

  user.lastLoginAt = new Date();
  const tokens = generateTokenPair(user);
  await _storeRefreshToken(user, tokens.refreshToken);
  await user.save({ validateBeforeSave: false });

  return { user, tokens };
};

// ─── Phone OTP Login via Firebase ─────────────────────────────────────────────

/**
 * Login or register via Firebase phone OTP.
 * The client handles the OTP flow using Firebase SDK and sends us the ID token.
 *
 * @param {string} phone          - Phone number (from client)
 * @param {string} firebaseIdToken - Firebase ID token after successful OTP
 */
const loginWithPhoneOTP = async ({ phone, firebaseIdToken }) => {
  // Verify the Firebase token on the server
  let decodedToken;
  try {
    decodedToken = await verifyFirebaseToken(firebaseIdToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired Firebase OTP token');
  }

  // Cross-check that the phone number matches
  if (decodedToken.phone_number && decodedToken.phone_number !== phone) {
    throw ApiError.unauthorized('Phone number mismatch');
  }

  let user = await User.findOne({ $or: [{ phone }, { firebaseUid: decodedToken.uid }] });

  if (!user) {
    // Auto-register new user from phone OTP (no password set)
    user = await User.create({
      username: `user_${crypto.randomBytes(4).toString('hex')}`,
      email: `${decodedToken.uid}@firebase.placeholder`, // placeholder; user should update
      phone,
      firebaseUid: decodedToken.uid,
      isPhoneVerified: true,
    });
    logger.info(`New user auto-registered via phone OTP: ${user._id}`);
  } else {
    if (user.isBanned) {
      throw ApiError.forbidden(`Account banned: ${user.banReason}`);
    }
    // Update Firebase UID and mark phone as verified
    user.firebaseUid = decodedToken.uid;
    user.isPhoneVerified = true;
    user.lastLoginAt = new Date();
  }

  const tokens = generateTokenPair(user);
  await _storeRefreshToken(user, tokens.refreshToken);
  await user.save({ validateBeforeSave: false });

  return { user, tokens };
};

// ─── Google OAuth ──────────────────────────────────────────────────────────────

/**
 * Login or register via Google OAuth.
 * Client exchanges the Google auth code for an ID token and sends it here.
 *
 * @param {string} idToken - Google ID token from client
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
    throw ApiError.unauthorized('Invalid Google ID token');
  }

  const { sub: googleId, email, name, picture } = payload;

  let user = await User.findOne({ $or: [{ googleId }, { email }] });

  if (!user) {
    // Auto-register with Google profile data
    user = await User.create({
      username: name?.replace(/\s+/g, '_').slice(0, 30) || `google_${crypto.randomBytes(4).toString('hex')}`,
      email,
      googleId,
      isEmailVerified: true, // Google verifies email
      profilePicture: { url: picture || '', publicId: '' },
    });
    logger.info(`New user registered via Google: ${user._id} (${email})`);
  } else {
    if (user.isBanned) {
      throw ApiError.forbidden(`Account banned: ${user.banReason}`);
    }
    user.googleId = googleId;
    user.isEmailVerified = true;
    user.lastLoginAt = new Date();
  }

  const tokens = generateTokenPair(user);
  await _storeRefreshToken(user, tokens.refreshToken);
  await user.save({ validateBeforeSave: false });

  return { user, tokens };
};

// ─── Token Refresh ────────────────────────────────────────────────────────────

/**
 * Rotate the refresh token — issues a new access + refresh token pair.
 * Validates that the provided refresh token matches the stored hash.
 */
const refreshTokens = async (incomingRefreshToken) => {
  const decoded = verifyRefreshToken(incomingRefreshToken);

  const user = await User.findById(decoded.userId).select('+refreshToken');
  if (!user || !user.refreshToken) {
    throw ApiError.unauthorized('Invalid refresh token');
  }

  // Compare hash (we store hashed refresh token)
  const hash = crypto.createHash('sha256').update(incomingRefreshToken).digest('hex');
  if (hash !== user.refreshToken) {
    throw ApiError.unauthorized('Refresh token reuse detected');
  }

  const tokens = generateTokenPair(user);
  await _storeRefreshToken(user, tokens.refreshToken);

  return { tokens };
};

// ─── Email Verification ───────────────────────────────────────────────────────

const verifyEmail = async (token) => {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: { $gt: Date.now() },
  }).select('+emailVerificationToken +emailVerificationExpires');

  if (!user) {
    throw ApiError.badRequest('Invalid or expired verification token');
  }

  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save({ validateBeforeSave: false });

  return user;
};

// ─── Logout ───────────────────────────────────────────────────────────────────

const logout = async (userId) => {
  await User.findByIdAndUpdate(userId, { $unset: { refreshToken: 1 } });
};

// ─── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Hash and store refresh token on the user document.
 * Storing a hash (not the raw token) means a compromised DB cannot reuse tokens.
 */
const _storeRefreshToken = async (user, refreshToken) => {
  user.refreshToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await user.save({ validateBeforeSave: false });
};

module.exports = {
  registerWithEmail,
  loginWithPassword,
  loginWithPhoneOTP,
  loginWithGoogle,
  refreshTokens,
  verifyEmail,
  logout,
};