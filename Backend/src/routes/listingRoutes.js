const express = require('express');
const router = express.Router();

const listingController = require('../controllers/listingController');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const { uploadListingImages } = require('../config/cloudinary');



const parseFormData = (req, res, next) => {
  if (req.body.location && typeof req.body.location === "string") {
    try {
      req.body.location = JSON.parse(req.body.location);
    } catch (err) {
      return next(new Error("Invalid JSON in location"));
    }
  }

  next();
};

// Wrap Multer to pass errors to Express error handler
const handleImageUpload = (req, res, next) => {
  uploadListingImages(req, res, (err) => {
    if (err) return next(err);
    next();
  });
};

// ─── Public Routes ────────────────────────────────────────────────────────────
router.get('/',     optionalAuth, listingController.getListings);
router.get('/my',   authenticate, listingController.getMyListings);  // before :id to avoid conflict
router.get('/:id',  optionalAuth, listingController.getListingById);

// ─── Protected Routes ─────────────────────────────────────────────────────────
router.post(
  '/',
  authenticate,
  handleImageUpload,
  parseFormData,
  validate(schemas.createListingSchema),
  listingController.createListing
);

router.patch(
  '/:id',
  authenticate,
  handleImageUpload,
  validate(schemas.updateListingSchema),
  listingController.updateListing
);

router.delete('/:id',                    authenticate, listingController.deleteListing);
router.delete('/:id/images/:publicId',   authenticate, listingController.deleteListingImage);
router.patch('/:id/sold',                authenticate, listingController.markAsSold);

module.exports = router;