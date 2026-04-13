const express = require('express');
const router = express.Router();

const userController = require('../controllers/userController');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const { uploadProfilePicture } = require('../config/cloudinary');

// Multer error wrapper
const handleUpload = (uploadFn) => (req, res, next) => {
  uploadFn(req, res, (err) => {
    if (err) return next(err);
    next();
  });
};

// All user routes require authentication
router.use(authenticate);

router.get('/profile',         userController.getProfile);
router.patch('/profile',       validate(schemas.updateProfileSchema), userController.updateProfile);
router.patch('/profile-picture', handleUpload(uploadProfilePicture),  userController.updateProfilePicture);
router.patch('/change-password', validate(schemas.changePasswordSchema), userController.changePassword);

// Public profile (no auth needed — override middleware for this one)
router.get('/:userId/public', userController.getPublicProfile);

module.exports = router;