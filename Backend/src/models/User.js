const mongoose = require('mongoose');

/**
 * User Schema — passwordless authentication only.
 *
 * Supported login methods:
 *   1. Phone + Firebase OTP  (firebaseUid)
 *   2. Email OTP             (emailOtpHash + emailOtpExpires)
 *   3. Google OAuth          (googleId)
 *
 * No password field exists anywhere in this schema.
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
      unique: true,
      sparse: true,       // allow null — phone-only users have no email initially
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },

    phone: {
      type: String,
      unique: true,
      sparse: true,       // allow null — email/OAuth users may have no phone initially
      trim: true,
      match: [/^\+?[1-9]\d{7,14}$/, 'Please provide a valid phone number with country code'],
    },

    profilePicture: {
      url:      { type: String, default: '' },
      publicId: { type: String, default: '' },
    },

    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },

    // ─── Verification status ───────────────────────────────────────────────
    isEmailVerified: { type: Boolean, default: false },
    isPhoneVerified: { type: Boolean, default: false },

    // ─── Email OTP ────────────────────────────────────────────────────────
    // 6-digit code stored as bcrypt hash for security
    emailOtpHash:    { type: String, select: false },
    emailOtpExpires: { type: Date,   select: false },

    // ─── Firebase (Phone OTP) ─────────────────────────────────────────────
    firebaseUid: { type: String, sparse: true },

    // ─── Google OAuth ─────────────────────────────────────────────────────
    googleId: { type: String, sparse: true },

    // ─── Refresh token (stored as SHA-256 hash) ───────────────────────────
    refreshToken: { type: String, select: false },

    // ─── Account status ───────────────────────────────────────────────────
    isBanned:  { type: Boolean, default: false },
    banReason: { type: String,  default: '' },

    // ─── Subscription tracking ────────────────────────────────────────────
    freeListingUsed: { type: Boolean, default: false },
    activeSubscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },

    // ─── Location ─────────────────────────────────────────────────────────
    location: {
      city:    { type: String, default: '' },
      state:   { type: String, default: '' },
      country: { type: String, default: 'India' },
    },

    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ googleId: 1 });
userSchema.index({ firebaseUid: 1 });
userSchema.index({ role: 1, createdAt: -1 });

// ─── Instance Methods ─────────────────────────────────────────────────────────

/**
 * Check whether the user has at least one verified login method.
 */
userSchema.methods.isVerified = function () {
  return this.isEmailVerified || this.isPhoneVerified;
};

/**
 * Return a safe public profile — never expose OTP hashes or tokens.
 */
userSchema.methods.toPublicProfile = function () {
  return {
    _id:             this._id,
    username:        this.username,
    email:           this.email,
    phone:           this.phone,
    profilePicture:  this.profilePicture,
    role:            this.role,
    isEmailVerified: this.isEmailVerified,
    isPhoneVerified: this.isPhoneVerified,
    isBanned:        this.isBanned,
    location:        this.location,
    freeListingUsed: this.freeListingUsed,
    createdAt:       this.createdAt,
  };
};

const User = mongoose.model('User', userSchema);

module.exports = User;