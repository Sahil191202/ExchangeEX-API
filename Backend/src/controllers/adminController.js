const User = require('../models/User');
const { Listing } = require('../models/Listing');
const { Transaction, Subscription } = require('../models/Subscription');
const { ApiError, ApiResponse, asyncHandler } = require('../utils/apiHelpers');
const logger = require('../utils/logger');

/**
 * GET /api/admin/users
 * List all users with pagination and optional filters
 */
const getAllUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, role, isBanned, search } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter = {};
  if (role) filter.role = role;
  if (isBanned !== undefined) filter.isBanned = isBanned === 'true';
  if (search) {
    filter.$or = [
      { username: new RegExp(search, 'i') },
      { email: new RegExp(search, 'i') },
      { phone: new RegExp(search, 'i') },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .select('-password -refreshToken -emailVerificationToken -passwordResetToken'),
    User.countDocuments(filter),
  ]);

  res.status(200).json(
    new ApiResponse(200, {
      users,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    }, 'Users fetched')
  );
});

/**
 * GET /api/admin/users/:userId
 * Get a single user with subscription and listing stats
 */
const getUserDetail = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const [user, listingCount, activeSubscription] = await Promise.all([
    User.findById(userId).select('-password -refreshToken -emailVerificationToken -passwordResetToken'),
    Listing.countDocuments({ seller: userId }),
    Subscription.findOne({ user: userId, status: 'active' }),
  ]);

  if (!user) throw ApiError.notFound('User not found');

  res.status(200).json(
    new ApiResponse(200, { user, listingCount, activeSubscription }, 'User detail fetched')
  );
});

/**
 * PATCH /api/admin/users/:userId/ban
 * Ban a user (with a required reason)
 */
const banUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { reason } = req.body;

  if (userId === req.user._id.toString()) {
    throw ApiError.badRequest('You cannot ban yourself');
  }

  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User not found');
  if (user.role === 'admin') throw ApiError.forbidden('Cannot ban an admin account');
  if (user.isBanned) throw ApiError.badRequest('User is already banned');

  user.isBanned = true;
  user.banReason = reason;
  await user.save({ validateBeforeSave: false });

  logger.info(`User ${userId} banned by admin ${req.user._id}. Reason: ${reason}`);

  res.status(200).json(
    new ApiResponse(200, { user: user.toPublicProfile() }, 'User banned successfully')
  );
});

/**
 * PATCH /api/admin/users/:userId/unban
 * Lift a ban on a user
 */
const unbanUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User not found');
  if (!user.isBanned) throw ApiError.badRequest('User is not banned');

  user.isBanned = false;
  user.banReason = '';
  await user.save({ validateBeforeSave: false });

  logger.info(`User ${userId} unbanned by admin ${req.user._id}`);

  res.status(200).json(
    new ApiResponse(200, { user: user.toPublicProfile() }, 'User unbanned successfully')
  );
});

/**
 * PATCH /api/admin/users/:userId/role
 * Promote or demote a user's role
 */
const changeUserRole = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body;

  if (!['user', 'admin'].includes(role)) {
    throw ApiError.badRequest("Role must be 'user' or 'admin'");
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { role },
    { new: true, runValidators: true }
  );

  if (!user) throw ApiError.notFound('User not found');

  logger.info(`User ${userId} role changed to '${role}' by admin ${req.user._id}`);

  res.status(200).json(
    new ApiResponse(200, { user: user.toPublicProfile() }, `User role updated to '${role}'`)
  );
});

/**
 * GET /api/admin/stats
 * Platform overview statistics
 */
const getPlatformStats = asyncHandler(async (req, res) => {
  const [
    totalUsers,
    totalListings,
    pendingListings,
    totalTransactions,
    revenueResult,
    newUsersToday,
  ] = await Promise.all([
    User.countDocuments(),
    Listing.countDocuments(),
    Listing.countDocuments({ status: 'pending' }),
    Transaction.countDocuments({ status: 'paid' }),
    Transaction.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    User.countDocuments({
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
    }),
  ]);

  const totalRevenue = revenueResult[0]?.total || 0;

  res.status(200).json(
    new ApiResponse(200, {
      totalUsers,
      totalListings,
      pendingListings,
      totalTransactions,
      totalRevenue,
      newUsersToday,
    }, 'Platform stats fetched')
  );
});

module.exports = { getAllUsers, getUserDetail, banUser, unbanUser, changeUserRole, getPlatformStats };