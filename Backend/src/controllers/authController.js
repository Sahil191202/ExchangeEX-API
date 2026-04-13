const authService = require('../services/authService');
const { ApiResponse, asyncHandler } = require('../utils/apiHelpers');

// ─── Phone OTP (Firebase) ─────────────────────────────────────────────────────

/**
 * POST /api/auth/phone/verify
 * Client already completed Firebase OTP on the device.
 * Sends the Firebase ID token here for server-side verification.
 */
const phoneVerify = asyncHandler(async (req, res) => {
  const { user, tokens, isNewUser } = await authService.loginWithPhoneOTP(req.body);

  res.status(200).json(
    new ApiResponse(200, {
      user: user.toPublicProfile(),
      ...tokens,
      isNewUser,           // client uses this to redirect to profile completion
    }, isNewUser ? 'Phone verified. Please complete your profile.' : 'Login successful.')
  );
});

// ─── Email OTP ────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/email/send-otp
 * Request a 6-digit OTP to be sent to the given email address.
 */
const emailSendOtp = asyncHandler(async (req, res) => {
  const result = await authService.sendEmailOtp(req.body);

  res.status(200).json(
    new ApiResponse(200, result, `OTP sent to ${req.body.email}. Valid for 10 minutes.`)
  );
});

/**
 * POST /api/auth/email/verify-otp
 * Submit the 6-digit OTP to complete email login / registration.
 */
const emailVerifyOtp = asyncHandler(async (req, res) => {
  const { user, tokens } = await authService.verifyEmailOtp(req.body);

  res.status(200).json(
    new ApiResponse(200, {
      user: user.toPublicProfile(),
      ...tokens,
    }, 'Email verified. Login successful.')
  );
});

// ─── Google OAuth ─────────────────────────────────────────────────────────────

/**
 * POST /api/auth/google
 * Login or register using a Google ID token from the client.
 */
const googleLogin = asyncHandler(async (req, res) => {
  const { user, tokens } = await authService.loginWithGoogle(req.body);

  res.status(200).json(
    new ApiResponse(200, {
      user: user.toPublicProfile(),
      ...tokens,
    }, 'Google login successful.')
  );
});

// ─── Token Refresh ────────────────────────────────────────────────────────────

/**
 * POST /api/auth/refresh
 * Exchange a valid refresh token for a new token pair.
 */
const refreshToken = asyncHandler(async (req, res) => {
  const { tokens } = await authService.refreshTokens(req.body.refreshToken);

  res.status(200).json(
    new ApiResponse(200, tokens, 'Tokens refreshed.')
  );
});

// ─── Logout ───────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/logout  🔒
 * Invalidate the server-side refresh token.
 */
const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user._id);

  res.status(200).json(
    new ApiResponse(200, null, 'Logged out successfully.')
  );
});

// ─── Get current user ─────────────────────────────────────────────────────────

/**
 * GET /api/auth/me  🔒
 */
const getMe = asyncHandler(async (req, res) => {
  res.status(200).json(
    new ApiResponse(200, { user: req.user.toPublicProfile() }, 'Profile fetched.')
  );
});

// ─── Complete profile (after first phone OTP registration) ───────────────────

/**
 * PATCH /api/auth/complete-profile  🔒
 * Lets a newly phone-registered user set a real username and/or add their email.
 */
const completeProfile = asyncHandler(async (req, res) => {
  const user = await authService.completeProfile(req.user._id, req.body);

  res.status(200).json(
    new ApiResponse(200, { user: user.toPublicProfile() }, 'Profile updated.')
  );
});

module.exports = {
  phoneVerify,
  emailSendOtp,
  emailVerifyOtp,
  googleLogin,
  refreshToken,
  logout,
  getMe,
  completeProfile,
};