const listingService = require('../services/listingService');
const { ApiResponse, asyncHandler } = require('../utils/apiHelpers');

/**
 * POST /api/listings
 * Create a new listing (requires auth + subscription or free slot)
 */
const createListing = asyncHandler(async (req, res) => {
  const listing = await listingService.createListing(req.body, req.user, req.files || []);

  res.status(201).json(
    new ApiResponse(201, { listing }, 'Listing submitted for review. You will be notified once approved.')
  );
});

/**
 * GET /api/listings
 * Get all approved listings with filters and pagination
 */
const getListings = asyncHandler(async (req, res) => {
  const result = await listingService.getListings(req.query);

  res.status(200).json(
    new ApiResponse(200, result, 'Listings fetched')
  );
});

/**
 * GET /api/listings/:id
 * Get a single approved listing (increments view count)
 */
const getListingById = asyncHandler(async (req, res) => {
  const listing = await listingService.getListingById(req.params.id, true);

  res.status(200).json(
    new ApiResponse(200, { listing }, 'Listing fetched')
  );
});

/**
 * GET /api/listings/my
 * Get the authenticated user's own listings (all statuses)
 */
const getMyListings = asyncHandler(async (req, res) => {
  const result = await listingService.getMyListings(req.user._id, req.query);

  res.status(200).json(
    new ApiResponse(200, result, 'Your listings fetched')
  );
});

/**
 * PATCH /api/listings/:id
 * Update a listing (only seller, sends back to pending)
 */
const updateListing = asyncHandler(async (req, res) => {
  const listing = await listingService.updateListing(
    req.params.id,
    req.body,
    req.user._id,
    req.files || []
  );

  res.status(200).json(
    new ApiResponse(200, { listing }, 'Listing updated and resubmitted for review')
  );
});

/**
 * DELETE /api/listings/:id
 * Delete own listing (seller only)
 */
const deleteListing = asyncHandler(async (req, res) => {
  await listingService.deleteListing(req.params.id, req.user._id);

  res.status(200).json(
    new ApiResponse(200, null, 'Listing deleted successfully')
  );
});

/**
 * DELETE /api/listings/:id/images/:publicId
 * Remove a single image from a listing
 */
const deleteListingImage = asyncHandler(async (req, res) => {
  const listing = await listingService.deleteListingImage(
    req.params.id,
    req.params.publicId,
    req.user._id
  );

  res.status(200).json(
    new ApiResponse(200, { listing }, 'Image deleted')
  );
});

/**
 * PATCH /api/listings/:id/sold
 * Mark listing as sold
 */
const markAsSold = asyncHandler(async (req, res) => {
  const listing = await listingService.markAsSold(req.params.id, req.user._id);

  res.status(200).json(
    new ApiResponse(200, { listing }, 'Listing marked as sold')
  );
});

// ─── Admin Controllers ────────────────────────────────────────────────────────

/**
 * GET /api/admin/listings
 * Get all listings (admin, all statuses)
 */
const getAllListingsAdmin = asyncHandler(async (req, res) => {
  const result = await listingService.getAllListingsAdmin(req.query);

  res.status(200).json(
    new ApiResponse(200, result, 'All listings fetched')
  );
});

/**
 * PATCH /api/admin/listings/:id/review
 * Approve or reject a pending listing
 */
const reviewListing = asyncHandler(async (req, res) => {
  const { action, reason } = req.body;
  const listing = await listingService.approveOrRejectListing(
    req.params.id,
    action,
    req.user._id,
    reason
  );

  res.status(200).json(
    new ApiResponse(200, { listing }, `Listing ${action}d successfully`)
  );
});

/**
 * PATCH /api/admin/listings/:id/remove
 * Force-remove a listing (admin)
 */
const removeListingAdmin = asyncHandler(async (req, res) => {
  const listing = await listingService.removeListing(req.params.id, req.user._id);

  res.status(200).json(
    new ApiResponse(200, { listing }, 'Listing removed')
  );
});

module.exports = {
  createListing,
  getListings,
  getListingById,
  getMyListings,
  updateListing,
  deleteListing,
  deleteListingImage,
  markAsSold,
  getAllListingsAdmin,
  reviewListing,
  removeListingAdmin,
};