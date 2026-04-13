const authService = require('../services/authService');
const { ApiResponse, asyncHandler } = require('../utils/apiHelpers');

/**
 * POST /api/auth/register
 * Register with email + password + phone
 */
const register = asyncHandler(async (req, res) => {
  const { user, tokens } = await authService.registerWithEmail(req.body);

  res.status(201).json(
    new ApiResponse(201, {
      user: user.toPublicProfile(),
      ...tokens,
    }, 'Registration successful. Please check your email to verify your account.')
  );
});

/**
 * POST /api/auth/login
 * Login with email/phone + password
 */
const login = asyncHandler(async (req, res) => {
  const { user, tokens } = await authService.loginWithPassword(req.body);

  res.status(200).json(
    new ApiResponse(200, {
      user: user.toPublicProfile(),
      ...tokens,
    }, 'Login successful')
  );
});

/**
 * POST /api/auth/phone-login
 * Login or register via Firebase phone OTP
 */
const phoneLogin = asyncHandler(async (req, res) => {
  const { user, tokens } = await authService.loginWithPhoneOTP(req.body);

  res.status(200).json(
    new ApiResponse(200, {
      user: user.toPublicProfile(),
      ...tokens,
    }, 'Phone login successful')
  );
});

/**
 * POST /api/auth/google
 * Login or register via Google OAuth
 */
const googleLogin = asyncHandler(async (req, res) => {
  const { user, tokens } = await authService.loginWithGoogle(req.body);

  res.status(200).json(
    new ApiResponse(200, {
      user: user.toPublicProfile(),
      ...tokens,
    }, 'Google login successful')
  );
});

/**
 * POST /api/auth/refresh
 * Get new access + refresh token pair
 */
const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.body;
  const { tokens } = await authService.refreshTokens(token);

  res.status(200).json(
    new ApiResponse(200, tokens, 'Tokens refreshed successfully')
  );
});

/**
 * GET /api/auth/verify-email?token=xxx
 * Verify email from the link sent in registration email
 */
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).json(new ApiResponse(400, null, 'Verification token is required'));
  }

  await authService.verifyEmail(token);

  res.status(200).json(
    new ApiResponse(200, null, 'Email verified successfully. You can now log in.')
  );
});

/**
 * POST /api/auth/logout
 * Invalidate refresh token on server side
 */
const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user._id);

  res.status(200).json(
    new ApiResponse(200, null, 'Logged out successfully')
  );
});

/**
 * GET /api/auth/me
 * Get the currently authenticated user's profile
 */
const getMe = asyncHandler(async (req, res) => {
  res.status(200).json(
    new ApiResponse(200, { user: req.user.toPublicProfile() }, 'Profile fetched')
  );
});

module.exports = { register, login, phoneLogin, googleLogin, refreshToken, verifyEmail, logout, getMe };