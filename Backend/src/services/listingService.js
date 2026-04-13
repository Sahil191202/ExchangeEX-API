const { Listing } = require('../models/Listing');
const { Subscription } = require('../models/Subscription');
const User = require('../models/User');
const { ApiError } = require('../utils/apiHelpers');
const emailService = require('./emailService');
const { deleteImage } = require('../config/cloudinary');
const logger = require('../utils/logger');

// ─── Create Listing ───────────────────────────────────────────────────────────

/**
 * Create a new listing.
 * Rules:
 *   1. First listing ever -> free (freeListingUsed flag)
 *   2. After that -> must have an active subscription with remaining credits
 *
 * @param {object} data  - Validated listing body
 * @param {object} user  - Authenticated user document
 * @param {Array}  files - Uploaded image files from Multer/Cloudinary
 */
const createListing = async (data, user, files = []) => {
  let subscriptionUsed = null;

  // ── Determine if free or paid ───────────────────────────────────────────
  if (!user.freeListingUsed) {
    // First listing is free — mark the flag
    await User.findByIdAndUpdate(user._id, { freeListingUsed: true });
  } else {
    // Need an active subscription
    const subscription = await Subscription.findOne({
      user: user._id,
      status: 'active',
      expiresAt: { $gt: new Date() },
    });

    if (!subscription || subscription.remainingCredits <= 0) {
      throw ApiError.badRequest(
        'You need an active subscription to post more listings. ' +
        'Purchase a plan: ₹50 for 1 listing or ₹400 for 10 listings.'
      );
    }

    await subscription.consumeCredit();
    subscriptionUsed = subscription._id;
  }

  // ── Build images array from uploaded files ──────────────────────────────
  const images = files.map((file, index) => ({
    url: file.path,          // Cloudinary URL
    publicId: file.filename, // Cloudinary public_id
    isPrimary: index === 0,  // First image is the primary
  }));

  // ── Create the listing (status = pending for admin approval) ───────────
  const listing = await Listing.create({
    ...data,
    seller: user._id,
    images,
    subscription: subscriptionUsed,
    status: 'pending',
  });

  // ── Notify user by email (non-blocking) ────────────────────────────────
  emailService.sendListingSubmittedEmail(user, listing).catch((err) =>
    logger.error(`Listing submitted email failed: ${err.message}`)
  );

  logger.info(`Listing created: ${listing._id} by user ${user._id}`);
  return listing;
};

// ─── Get Listings (Public, paginated, filtered) ───────────────────────────────

/**
 * Fetch approved listings with filters, full-text search, and pagination.
 */
const getListings = async (query) => {
  const {
    page = 1,
    limit = 20,
    category,
    minPrice,
    maxPrice,
    city,
    search,
    sort = 'newest',
    condition,
  } = query;

  const filter = { status: 'approved' };

  if (category) filter.category = category;
  if (condition) filter.condition = condition;
  if (city) filter['location.city'] = new RegExp(city, 'i');
  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.price = {};
    if (minPrice !== undefined) filter.price.$gte = Number(minPrice);
    if (maxPrice !== undefined) filter.price.$lte = Number(maxPrice);
  }

  // Full-text search via MongoDB text index
  if (search) {
    filter.$text = { $search: search };
  }

  const sortMap = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    'price-asc': { price: 1 },
    'price-desc': { price: -1 },
  };
  const sortOption = search
    ? { score: { $meta: 'textScore' }, ...sortMap[sort] }
    : sortMap[sort];

  const skip = (Number(page) - 1) * Number(limit);

  const [listings, total] = await Promise.all([
    Listing.find(filter)
      .sort(sortOption)
      .skip(skip)
      .limit(Number(limit))
      .select('-__v')
      .populate('seller', 'username profilePicture phone location'),
    Listing.countDocuments(filter),
  ]);

  return {
    listings,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)),
    },
  };
};

// ─── Get Single Listing ───────────────────────────────────────────────────────

const getListingById = async (listingId, incrementView = false) => {
  const listing = await Listing.findById(listingId)
    .populate('seller', 'username profilePicture phone location createdAt')
    .select('-__v');

  if (!listing) throw ApiError.notFound('Listing not found');

  if (listing.status !== 'approved') {
    throw ApiError.notFound('Listing not found or not yet approved');
  }

  // Increment view count atomically (fire-and-forget)
  if (incrementView) {
    Listing.findByIdAndUpdate(listingId, { $inc: { viewCount: 1 } }).exec();
  }

  return listing;
};

// ─── Get My Listings ──────────────────────────────────────────────────────────

const getMyListings = async (userId, { page = 1, limit = 20, status }) => {
  const filter = { seller: userId };
  if (status) filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);

  const [listings, total] = await Promise.all([
    Listing.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .select('-__v'),
    Listing.countDocuments(filter),
  ]);

  return {
    listings,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
  };
};

// ─── Update Listing ───────────────────────────────────────────────────────────

/**
 * Update listing fields. Only the seller can update.
 * Updating sends listing back to pending for re-approval.
 */
const updateListing = async (listingId, data, userId, newFiles = []) => {
  const listing = await Listing.findById(listingId);
  if (!listing) throw ApiError.notFound('Listing not found');

  if (listing.seller.toString() !== userId.toString()) {
    throw ApiError.forbidden('You are not authorized to update this listing');
  }

  if (['removed', 'sold'].includes(listing.status)) {
    throw ApiError.badRequest('Cannot update a removed or sold listing');
  }

  // Append new images if uploaded
  if (newFiles.length > 0) {
    const newImages = newFiles.map((file, index) => ({
      url: file.path,
      publicId: file.filename,
      isPrimary: listing.images.length === 0 && index === 0,
    }));
    listing.images.push(...newImages);
    if (listing.images.length > 10) {
      throw ApiError.badRequest('A listing cannot have more than 10 images');
    }
  }

  // Apply field updates
  Object.assign(listing, data);

  // Re-submit for approval if it was previously approved/rejected
  if (['approved', 'rejected'].includes(listing.status)) {
    listing.status = 'pending';
    listing.approvedBy = undefined;
    listing.approvedAt = undefined;
    listing.rejectedBy = undefined;
    listing.rejectedAt = undefined;
    listing.rejectionReason = '';
  }

  await listing.save();
  logger.info(`Listing updated: ${listingId} by user ${userId}`);
  return listing;
};

// ─── Delete Listing ───────────────────────────────────────────────────────────

const deleteListing = async (listingId, userId) => {
  const listing = await Listing.findById(listingId);
  if (!listing) throw ApiError.notFound('Listing not found');

  if (listing.seller.toString() !== userId.toString()) {
    throw ApiError.forbidden('You are not authorized to delete this listing');
  }

  // Delete images from Cloudinary in parallel
  await Promise.all(listing.images.map((img) => deleteImage(img.publicId)));

  await listing.deleteOne();
  logger.info(`Listing deleted: ${listingId} by user ${userId}`);
};

// ─── Delete a Single Image from Listing ──────────────────────────────────────

const deleteListingImage = async (listingId, publicId, userId) => {
  const listing = await Listing.findById(listingId);
  if (!listing) throw ApiError.notFound('Listing not found');

  if (listing.seller.toString() !== userId.toString()) {
    throw ApiError.forbidden('Not authorized');
  }

  const imageIndex = listing.images.findIndex((img) => img.publicId === publicId);
  if (imageIndex === -1) throw ApiError.notFound('Image not found in this listing');

  if (listing.images.length === 1) {
    throw ApiError.badRequest('Cannot delete the only image. Update the listing with a new image first.');
  }

  // Remove from Cloudinary and from document
  await deleteImage(publicId);
  listing.images.splice(imageIndex, 1);

  // Ensure at least one image is primary
  if (!listing.images.some((img) => img.isPrimary)) {
    listing.images[0].isPrimary = true;
  }

  await listing.save();
  return listing;
};

// ─── Mark as Sold ─────────────────────────────────────────────────────────────

const markAsSold = async (listingId, userId) => {
  const listing = await Listing.findById(listingId);
  if (!listing) throw ApiError.notFound('Listing not found');

  if (listing.seller.toString() !== userId.toString()) {
    throw ApiError.forbidden('Not authorized');
  }

  listing.status = 'sold';
  await listing.save();
  return listing;
};

// ─── Admin: Approve or Reject ─────────────────────────────────────────────────

const approveOrRejectListing = async (listingId, action, adminId, reason = '') => {
  const listing = await Listing.findById(listingId).populate('seller', 'email username');
  if (!listing) throw ApiError.notFound('Listing not found');

  if (listing.status !== 'pending') {
    throw ApiError.badRequest(`Listing is already ${listing.status}`);
  }

  const now = new Date();

  if (action === 'approve') {
    listing.status = 'approved';
    listing.approvedBy = adminId;
    listing.approvedAt = now;
    await listing.save();

    emailService.sendListingApprovedEmail(listing.seller, listing).catch((err) =>
      logger.error(`Approved email failed: ${err.message}`)
    );
  } else {
    listing.status = 'rejected';
    listing.rejectedBy = adminId;
    listing.rejectedAt = now;
    listing.rejectionReason = reason;
    await listing.save();

    emailService.sendListingRejectedEmail(listing.seller, listing).catch((err) =>
      logger.error(`Rejected email failed: ${err.message}`)
    );
  }

  logger.info(`Listing ${listingId} ${action}d by admin ${adminId}`);
  return listing;
};

// ─── Admin: Force Remove Listing ──────────────────────────────────────────────

const removeListing = async (listingId, adminId) => {
  const listing = await Listing.findById(listingId);
  if (!listing) throw ApiError.notFound('Listing not found');

  listing.status = 'removed';
  listing.removedBy = adminId;
  listing.removedAt = new Date();
  await listing.save();

  logger.info(`Listing ${listingId} removed by admin ${adminId}`);
  return listing;
};

// ─── Admin: Get All Listings (all statuses) ───────────────────────────────────

const getAllListingsAdmin = async ({ page = 1, limit = 20, status, category }) => {
  const filter = {};
  if (status) filter.status = status;
  if (category) filter.category = category;

  const skip = (Number(page) - 1) * Number(limit);

  const [listings, total] = await Promise.all([
    Listing.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('seller', 'username email phone')
      .populate('approvedBy', 'username')
      .populate('rejectedBy', 'username')
      .select('-__v'),
    Listing.countDocuments(filter),
  ]);

  return {
    listings,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
  };
};

module.exports = {
  createListing,
  getListings,
  getListingById,
  getMyListings,
  updateListing,
  deleteListing,
  deleteListingImage,
  markAsSold,
  approveOrRejectListing,
  removeListing,
  getAllListingsAdmin,
};