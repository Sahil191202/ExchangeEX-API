const mongoose = require('mongoose');

// ─── Subscription Plans ───────────────────────────────────────────────────────
const PLAN_TYPES = {
  SINGLE: 'single',       // ₹50 — 1 listing credit
  BUNDLE: 'bundle',       // ₹400 — 10 listing credits
};

const PLAN_CONFIG = {
  [PLAN_TYPES.SINGLE]: { credits: 1, price: 50 },
  [PLAN_TYPES.BUNDLE]: { credits: 10, price: 400 },
};

/**
 * Subscription Schema
 * Represents a purchased plan that gives the user N listing credits.
 * Credits are decremented each time a paid listing is created.
 */
const subscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    plan: {
      type: String,
      enum: Object.values(PLAN_TYPES),
      required: true,
    },

    totalCredits: {
      type: Number,
      required: true,
      min: 1,
    },

    usedCredits: {
      type: Number,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: ['active', 'exhausted', 'expired', 'cancelled'],
      default: 'active',
    },

    // ─── Payment reference ─────────────────────────────────────────────────
    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
    },

    // ─── Validity ──────────────────────────────────────────────────────────
    activatedAt: { type: Date, default: Date.now },
    expiresAt: {
      type: Date,
      default: () => {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1); // 1 year validity
        return d;
      },
    },
  },
  { timestamps: true }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
subscriptionSchema.index({ user: 1, status: 1 });
subscriptionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL

// ─── Virtual: remaining credits ───────────────────────────────────────────────
subscriptionSchema.virtual('remainingCredits').get(function () {
  return this.totalCredits - this.usedCredits;
});

// ─── Instance method: consume one credit ─────────────────────────────────────
subscriptionSchema.methods.consumeCredit = async function () {
  if (this.remainingCredits <= 0) {
    throw new Error('No credits remaining on this subscription');
  }
  this.usedCredits += 1;
  if (this.usedCredits >= this.totalCredits) {
    this.status = 'exhausted';
  }
  return this.save();
};

const Subscription = mongoose.model('Subscription', subscriptionSchema);

// ─── Transaction Schema ───────────────────────────────────────────────────────

/**
 * Transaction Schema
 * Records every payment attempt, whether successful or not.
 * Linked to a Razorpay order/payment.
 */
const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    plan: {
      type: String,
      enum: Object.values(PLAN_TYPES),
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: 'INR',
    },

    status: {
      type: String,
      enum: ['created', 'paid', 'failed', 'refunded'],
      default: 'created',
    },

    // ─── Razorpay identifiers ──────────────────────────────────────────────
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, sparse: true },
    razorpaySignature: { type: String, select: false }, // don't expose

    // ─── Subscription created on success ──────────────────────────────────
    subscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },

    failureReason: { type: String, default: '' },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ razorpayOrderId: 1 });
transactionSchema.index({ status: 1 });

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = { Subscription, Transaction, PLAN_TYPES, PLAN_CONFIG };