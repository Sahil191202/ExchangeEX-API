const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const logger = require('../utils/logger');

// Configure Cloudinary with credentials from env
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Create a Cloudinary-backed Multer storage for listing images.
 * - Uploads to 'olx/listings' folder
 * - Accepts jpg, jpeg, png, webp
 * - Max 5MB per file, up to 5 files
 */
const listingImageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'olx/listings',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1200, height: 900, crop: 'limit', quality: 'auto' }],
  },
});

/**
 * Cloudinary storage for profile pictures.
 */
const profilePictureStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'olx/profiles',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto' }],
  },
});

/** File size and type filter */
const imageFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (jpg, png, webp) are allowed'), false);
  }
};

// Multer upload instances
const uploadListingImages = multer({
  storage: listingImageStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
}).array('images', 5);

const uploadProfilePicture = multer({
  storage: profilePictureStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
}).single('profilePicture');

/**
 * Delete an image from Cloudinary by public_id.
 * @param {string} publicId
 */
const deleteImage = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId);
    logger.info(`Cloudinary image deleted: ${publicId}`);
  } catch (error) {
    logger.error(`Failed to delete Cloudinary image ${publicId}: ${error.message}`);
  }
};

module.exports = { cloudinary, uploadListingImages, uploadProfilePicture, deleteImage };