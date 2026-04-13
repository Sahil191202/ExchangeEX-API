const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

/**
 * User Schema
 * Supports both email/password registration and phone OTP / Google OAuth.
 * refreshToken is stored hashed to allow server-side invalidation.
 */
const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      trim: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [30, 'Username cannot exceed 30 characters'],
      match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'],
    },

    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },

    phone: {
      type: String,
      unique: true,
      sparse: true, // allow null/undefined without unique conflict
      trim: true,
      match: [/^\+?[1-9]\d{7,14}$/, 'Please provide a valid phone number with country code'],
    },

    password: {
      type: String,
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // never return password in queries by default
    },

    profilePicture: {
      url: { type: String, default: '' },
      publicId: { type: String, default: '' }, // Cloudinary public_id for deletion
    },

    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },

    // ─── Verification ─────────────────────────────────────────────────────
    isEmailVerified: { type: Boolean, default: false },
    isPhoneVerified: { type: Boolean, default: false },

    emailVerificationToken: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },

    // ─── Password Reset ───────────────────────────────────────────────────
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },

    // ─── OAuth ────────────────────────────────────────────────────────────
    googleId: { type: String, sparse: true },
    firebaseUid: { type: String, sparse: true }, // from Firebase phone auth

    // ─── Auth tokens ──────────────────────────────────────────────────────
    refreshToken: { type: String, select: false },

    // ─── Account status ───────────────────────────────────────────────────
    isBanned: { type: Boolean, default: false },
    banReason: { type: String, default: '' },

    // ─── Subscription tracking ────────────────────────────────────────────
    freeListingUsed: { type: Boolean, default: false },
    activeSubscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },

    // ─── Location (optional, for profile) ────────────────────────────────
    location: {
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      country: { type: String, default: 'India' },
    },

    lastLoginAt: { type: Date },
  },
  {
    timestamps: true, // createdAt, updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ googleId: 1 });
userSchema.index({ firebaseUid: 1 });
userSchema.index({ role: 1, createdAt: -1 });

// ─── Virtual: full name ────────────────────────────────────────────────────────
// (kept as username here; extend with firstName/lastName if needed)
userSchema.virtual('displayName').get(function () {
  return this.username;
});

// ─── Pre-save hook: hash password ─────────────────────────────────────────────
userSchema.pre('save', async function (next) {
  // Only hash if password field was modified
  if (!this.isModified('password') || !this.password) return next();

  try {
    this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
    next();
  } catch (err) {
    next(err);
  }
});

// ─── Instance Methods ─────────────────────────────────────────────────────────

/**
 * Compare a plain-text password against the stored hash.
 * @param {string} candidatePassword
 * @returns {Promise<boolean>}
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Check if the user can create a new listing for free.
 * First listing is always free.
 */
userSchema.methods.canPostFree = function () {
  return !this.freeListingUsed;
};

/**
 * Return a safe public profile (strip sensitive fields).
 */
userSchema.methods.toPublicProfile = function () {
  return {
    _id: this._id,
    username: this.username,
    email: this.email,
    phone: this.phone,
    profilePicture: this.profilePicture,
    role: this.role,
    isEmailVerified: this.isEmailVerified,
    isPhoneVerified: this.isPhoneVerified,
    isBanned: this.isBanned,
    location: this.location,
    freeListingUsed: this.freeListingUsed,
    createdAt: this.createdAt,
  };
};

const User = mongoose.model('User', userSchema);

module.exports = User;