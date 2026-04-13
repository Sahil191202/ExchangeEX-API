const mongoose = require('mongoose');

/**
 * Listing Schema — the core entity of the platform.
 * A listing goes through: draft → pending → approved (or rejected).
 * Admin must approve before it becomes publicly visible.
 */

const CATEGORIES = [
  'electronics',
  'vehicles',
  'furniture',
  'real-estate',
  'fashion',
  'books',
  'sports',
  'toys',
  'jobs',
  'services',
  'pets',
  'other',
];

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true }, // Cloudinary public_id
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false }
);

const listingSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Listing title is required'],
      trim: true,
      minlength: [10, 'Title must be at least 10 characters'],
      maxlength: [100, 'Title cannot exceed 100 characters'],
    },

    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      minlength: [20, 'Description must be at least 20 characters'],
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },

    category: {
      type: String,
      required: [true, 'Category is required'],
      enum: { values: CATEGORIES, message: 'Invalid category' },
    },

    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },

    // ─── Images ───────────────────────────────────────────────────────────
    images: {
      type: [imageSchema],
      validate: {
        validator: (v) => v.length <= 5,
        message: 'A listing can have at most 10 images',
      },
    },

    // ─── Location ─────────────────────────────────────────────────────────
    location: {
      address: { type: String, required: [true, 'Address is required'], trim: true },
      city: { type: String, required: [true, 'City is required'], trim: true },
      state: { type: String, required: [true, 'State is required'], trim: true },
      country: { type: String, default: 'India', trim: true },
      pincode: { type: String, trim: true },
      // GeoJSON point for location-based search
      coordinates: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
      },
    },

    // ─── Contact ──────────────────────────────────────────────────────────
    contactPhone: {
      type: String,
      required: [true, 'Contact phone is required'],
      match: [/^\+?[1-9]\d{7,14}$/, 'Please provide a valid contact phone'],
    },

    // ─── Ownership ────────────────────────────────────────────────────────
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // ─── Approval workflow ────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['draft', 'pending', 'approved', 'rejected', 'sold', 'removed'],
      default: 'pending',
    },

    rejectionReason: { type: String, default: '' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: { type: Date },
    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    removedAt: { type: Date },

    // ─── Extras ───────────────────────────────────────────────────────────
    condition: {
      type: String,
      enum: ['new', 'like-new', 'good', 'fair', 'poor'],
      default: 'good',
    },

    isNegotiable: { type: Boolean, default: true },
    viewCount: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false },
    expiresAt: { type: Date }, // auto-expire listings after 60 days

    // ─── Subscription ref ─────────────────────────────────────────────────
    // Which subscription paid for this listing (null = free)
    subscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
listingSchema.index({ seller: 1, status: 1 });
listingSchema.index({ category: 1, status: 1, createdAt: -1 });
listingSchema.index({ status: 1, createdAt: -1 });
listingSchema.index({ 'location.coordinates': '2dsphere' }); // geospatial
listingSchema.index({ title: 'text', description: 'text' }); // full-text search
listingSchema.index({ price: 1 });
listingSchema.index({ isFeatured: -1, createdAt: -1 });

// ─── Pre-save: set expiry ─────────────────────────────────────────────────────
listingSchema.pre('save', function (next) {
  if (!this.expiresAt) {
    const now = new Date();
    this.expiresAt = new Date(now.setDate(now.getDate() + 60)); // 60 days
  }
  next();
});

// ─── Virtual: primary image ───────────────────────────────────────────────────
listingSchema.virtual('primaryImage').get(function () {
  if (!this.images || this.images.length === 0) return null;
  return this.images.find((img) => img.isPrimary) || this.images[0];
});

const Listing = mongoose.model('Listing', listingSchema);

module.exports = { Listing, CATEGORIES };