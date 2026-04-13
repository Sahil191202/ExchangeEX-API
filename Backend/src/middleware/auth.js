const { verifyAccessToken } = require('../utils/jwt');
const { ApiError, asyncHandler } = require('../utils/apiHelpers');
const User = require('../models/User');

/**
 * authenticate — verifies the JWT in Authorization header.
 * On success, attaches req.user (full user document, minus sensitive fields).
 * On failure, throws 401.
 *
 * Usage: router.get('/protected', authenticate, controller)
 */
const authenticate = asyncHandler(async (req, res, next) => {
  // Support both "Bearer <token>" header and httpOnly cookie
  let token;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies?.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    throw ApiError.unauthorized('No authentication token provided');
  }

  // Verify signature & expiry
  const decoded = verifyAccessToken(token);

  // Fetch fresh user data (catches bans, role changes since token was issued)
  const user = await User.findById(decoded.userId).select(
    '-password -refreshToken -emailVerificationToken -passwordResetToken'
  );

  if (!user) {
    throw ApiError.unauthorized('User no longer exists');
  }

  if (user.isBanned) {
    throw ApiError.forbidden(`Your account has been banned. Reason: ${user.banReason || 'Policy violation'}`);
  }

  req.user = user;
  next();
});

/**
 * authorize — role-based access control guard.
 * Must be chained AFTER authenticate.
 *
 * @param  {...string} roles - Allowed roles (e.g., 'admin', 'user')
 * Usage: router.delete('/admin/users/:id', authenticate, authorize('admin'), controller)
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }
    if (!roles.includes(req.user.role)) {
      return next(
        ApiError.forbidden(
          `Role '${req.user.role}' is not authorized to access this resource`
        )
      );
    }
    next();
  };
};

/**
 * optionalAuth — same as authenticate but doesn't fail if no token is present.
 * Useful for public endpoints that show extra data to logged-in users.
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  let token;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies?.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) return next(); // no token — continue as unauthenticated

  try {
    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.userId).select(
      '-password -refreshToken -emailVerificationToken -passwordResetToken'
    );
    if (user && !user.isBanned) req.user = user;
  } catch {
    // silently ignore invalid token for optional auth
  }

  next();
});

/**
 * requireEmailVerified — ensures user has verified their email.
 * Chain after authenticate.
 */
const requireEmailVerified = (req, res, next) => {
  if (!req.user.isEmailVerified) {
    return next(ApiError.forbidden('Please verify your email address to access this feature'));
  }
  next();
};

module.exports = { authenticate, authorize, optionalAuth, requireEmailVerified };