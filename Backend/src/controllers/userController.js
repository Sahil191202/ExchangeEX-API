const User = require('../models/User');
const { ApiError, ApiResponse, asyncHandler } = require('../utils/apiHelpers');
const { deleteImage } = require('../config/cloudinary');
const logger = require('../utils/logger');

/**
 * GET /api/users/profile
 * Get authenticated user's full profile
 */
const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
    .populate('activeSubscription', 'plan totalCredits usedCredits status expiresAt');

  res.status(200).json(
    new ApiResponse(200, { user: user.toPublicProfile() }, 'Profile fetched')
  );
});

/**
 * PATCH /api/users/profile
 * Update profile fields (username, email, phone, location)
 */
const updateProfile = asyncHandler(async (req, res) => {
  const allowedFields = ['username', 'email', 'phone', 'location'];
  const updates = {};

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  // If email is being changed, mark as unverified
  if (updates.email && updates.email !== req.user.email) {
    updates.isEmailVerified = false;
    // TODO: send new verification email
  }

  // If phone is being changed, mark as unverified
  if (updates.phone && updates.phone !== req.user.phone) {
    updates.isPhoneVerified = false;
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    updates,
    { new: true, runValidators: true }
  );

  res.status(200).json(
    new ApiResponse(200, { user: user.toPublicProfile() }, 'Profile updated successfully')
  );
});

/**
 * PATCH /api/users/profile-picture
 * Upload a new profile picture (Multer/Cloudinary handles the upload)
 */
const updateProfilePicture = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw ApiError.badRequest('No image file provided');
  }

  const user = await User.findById(req.user._id);

  // Delete old profile picture from Cloudinary if it exists
  if (user.profilePicture?.publicId) {
    await deleteImage(user.profilePicture.publicId);
  }

  user.profilePicture = {
    url: req.file.path,
    publicId: req.file.filename,
  };

  await user.save({ validateBeforeSave: false });

  res.status(200).json(
    new ApiResponse(200, { profilePicture: user.profilePicture }, 'Profile picture updated')
  );
});

/**
 * PATCH /api/users/change-password
 * Change password (requires current password)
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select('+password');

  if (!user.password) {
    throw ApiError.badRequest('Your account uses social login. Password change is not available.');
  }

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    throw ApiError.unauthorized('Current password is incorrect');
  }

  if (currentPassword === newPassword) {
    throw ApiError.badRequest('New password must be different from current password');
  }

  user.password = newPassword; // pre-save hook will hash it
  await user.save();

  logger.info(`Password changed for user ${user._id}`);

  res.status(200).json(
    new ApiResponse(200, null, 'Password changed successfully')
  );
});

/**
 * GET /api/users/:userId/public
 * Get a public user profile (for listing seller info)
 */
const getPublicProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.userId)
    .select('username profilePicture location createdAt');

  if (!user) throw ApiError.notFound('User not found');

  res.status(200).json(
    new ApiResponse(200, { user }, 'Public profile fetched')
  );
});

module.exports = { getProfile, updateProfile, updateProfilePicture, changePassword, getPublicProfile };