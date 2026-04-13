const Joi = require('joi');
const { ApiError } = require('../utils/apiHelpers');
const { CATEGORIES } = require('../models/Listing');

// ─── Middleware Factory ────────────────────────────────────────────────────────

/**
 * Returns an Express middleware that validates req.body against a Joi schema.
 * On failure throws a 400 ApiError with per-field error details.
 *
 * @param {Joi.Schema} schema
 */
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly:    false,  // collect ALL errors
    stripUnknown:  true,   // remove unexpected fields (security)
    convert:       true,   // type coercion (string -> number etc.)
  });

  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.path.join('.'),
      message: d.message.replace(/['"]/g, ''),
    }));
    return next(ApiError.badRequest('Validation failed', errors));
  }

  req.body = value; // replace with sanitized + coerced value
  next();
};

// ─── Reusable field definitions ────────────────────────────────────────────────

const phone = Joi.string()
  .pattern(/^\+?[1-9]\d{7,14}$/)
  .messages({ 'string.pattern.base': 'Phone must be a valid international number (e.g. +919876543210)' });

const email = Joi.string()
  .email({ tlds: { allow: false } })
  .lowercase()
  .trim();

const otp = Joi.string()
  .length(6)
  .pattern(/^\d{6}$/)
  .messages({
    'string.length':        'OTP must be exactly 6 digits',
    'string.pattern.base':  'OTP must contain only digits',
  });

const objectId = Joi.string()
  .pattern(/^[0-9a-fA-F]{24}$/)
  .messages({ 'string.pattern.base': 'Must be a valid ID' });

// ─── Auth Schemas ─────────────────────────────────────────────────────────────

/**
 * Phone OTP login (Firebase):
 * Client sends the phone number + Firebase ID token after successful OTP entry.
 */
const phoneOtpSchema = Joi.object({
  phone: phone.required(),
  firebaseIdToken: Joi.string().required().messages({
    'any.required': 'Firebase ID token is required after OTP verification',
    'string.empty': 'Firebase ID token cannot be empty',
  }),
});

/**
 * Email OTP — step 1: request OTP.
 */
const emailSendOtpSchema = Joi.object({
  email: email.required(),
});

/**
 * Email OTP — step 2: submit OTP.
 */
const emailVerifyOtpSchema = Joi.object({
  email: email.required(),
  otp:   otp.required(),
});

/**
 * Google OAuth login.
 */
const googleOAuthSchema = Joi.object({
  idToken: Joi.string().required().messages({
    'any.required': 'Google ID token is required',
  }),
});

/**
 * Refresh token rotation.
 */
const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

/**
 * Complete profile after first phone OTP registration.
 * At least one field is required.
 */
const completeProfileSchema = Joi.object({
  username: Joi.string()
    .alphanum()
    .min(3)
    .max(30),
  email: email,
}).min(1).messages({
  'object.min': 'Provide at least one field to update (username or email)',
});

// ─── User Schemas ─────────────────────────────────────────────────────────────

const updateProfileSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30),
  email:    email,
  phone:    phone,
  location: Joi.object({
    city:    Joi.string().max(100),
    state:   Joi.string().max(100),
    country: Joi.string().max(100),
  }),
}).min(1);

// ─── Listing Schemas ──────────────────────────────────────────────────────────

const createListingSchema = Joi.object({
  title:        Joi.string().min(10).max(100).required(),
  description:  Joi.string().min(20).max(2000).required(),
  category:     Joi.string().valid(...CATEGORIES).required(),
  price:        Joi.number().min(0).required(),
  contactPhone: phone.required(),
  condition:    Joi.string().valid('new', 'like-new', 'good', 'fair', 'poor').default('good'),
  isNegotiable: Joi.boolean().default(true),
  location: Joi.object({
    address:     Joi.string().max(200).required(),
    city:        Joi.string().max(100).required(),
    state:       Joi.string().max(100).required(),
    country:     Joi.string().max(100).default('India'),
    pincode:     Joi.string().max(10),
    coordinates: Joi.object({
      type:        Joi.string().valid('Point').default('Point'),
      coordinates: Joi.array().items(Joi.number()).length(2),
    }),
  }).required(),
});

const updateListingSchema = Joi.object({
  title:        Joi.string().min(10).max(100),
  description:  Joi.string().min(20).max(2000),
  price:        Joi.number().min(0),
  condition:    Joi.string().valid('new', 'like-new', 'good', 'fair', 'poor'),
  isNegotiable: Joi.boolean(),
  contactPhone: phone,
  location: Joi.object({
    address:  Joi.string().max(200),
    city:     Joi.string().max(100),
    state:    Joi.string().max(100),
    country:  Joi.string().max(100),
    pincode:  Joi.string().max(10),
  }),
}).min(1);

const listingQuerySchema = Joi.object({
  page:      Joi.number().integer().min(1).default(1),
  limit:     Joi.number().integer().min(1).max(50).default(20),
  category:  Joi.string().valid(...CATEGORIES),
  minPrice:  Joi.number().min(0),
  maxPrice:  Joi.number().min(0),
  city:      Joi.string(),
  search:    Joi.string().max(200),
  sort:      Joi.string().valid('newest', 'oldest', 'price-asc', 'price-desc').default('newest'),
  condition: Joi.string().valid('new', 'like-new', 'good', 'fair', 'poor'),
});

// ─── Admin Schemas ────────────────────────────────────────────────────────────

const approveRejectSchema = Joi.object({
  action: Joi.string().valid('approve', 'reject').required(),
  reason: Joi.when('action', {
    is:        'reject',
    then:      Joi.string().min(10).max(500).required().messages({
      'any.required': 'Rejection reason is required when rejecting a listing',
    }),
    otherwise: Joi.string().optional(),
  }),
});

const banUserSchema = Joi.object({
  reason: Joi.string().min(5).max(500).required(),
});

// ─── Payment Schemas ──────────────────────────────────────────────────────────

const createOrderSchema = Joi.object({
  plan: Joi.string().valid('single', 'bundle').required(),
});

const verifyPaymentSchema = Joi.object({
  razorpayOrderId:   Joi.string().required(),
  razorpayPaymentId: Joi.string().required(),
  razorpaySignature: Joi.string().required(),
});

// ─── Chat Schemas ─────────────────────────────────────────────────────────────

const sendMessageSchema = Joi.object({
  text: Joi.string().max(1000).when('type', {
    is:   'text',
    then: Joi.required(),
  }),
  type:        Joi.string().valid('text', 'image', 'offer').default('text'),
  offerAmount: Joi.number().min(0).when('type', {
    is:   'offer',
    then: Joi.required(),
  }),
});

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  validate,
  schemas: {
    // Auth — passwordless
    phoneOtpSchema,
    emailSendOtpSchema,
    emailVerifyOtpSchema,
    googleOAuthSchema,
    refreshTokenSchema,
    completeProfileSchema,
    // User
    updateProfileSchema,
    // Listing
    createListingSchema,
    updateListingSchema,
    listingQuerySchema,
    // Admin
    approveRejectSchema,
    banUserSchema,
    // Payment
    createOrderSchema,
    verifyPaymentSchema,
    // Chat
    sendMessageSchema,
  },
};