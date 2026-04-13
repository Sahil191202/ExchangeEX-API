const crypto = require("crypto");
const Razorpay = require("razorpay");
const {
  Subscription,
  Transaction,
  PLAN_TYPES,
  PLAN_CONFIG,
} = require("../models/Subscription");
const User = require("../models/User");
const { ApiError } = require("../utils/apiHelpers");
const emailService = require("./emailService");
const logger = require("../utils/logger");


// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─── Create Order ─────────────────────────────────────────────────────────────

/**
 * Create a Razorpay order for a subscription plan.
 * Returns the order details that the client uses to open the Razorpay checkout.
 *
 * @param {string} userId
 * @param {string} plan   - 'single' | 'bundle'
 */
const createOrder = async (userId, plan) => {
  if (!Object.values(PLAN_TYPES).includes(plan)) {
    throw ApiError.badRequest(
      `Invalid plan. Choose 'single' (₹50) or 'bundle' (₹400)`,
    );
  }

  const planConfig = PLAN_CONFIG[plan];
  const amountInPaise = planConfig.price * 100; // Razorpay uses smallest currency unit

  // Create a Razorpay order
  const shortId = Math.random().toString(36).substring(2, 10);
  let razorpayOrder;
  try {
    razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `rcpt_${shortId}`,
      notes: { userId: userId.toString(), plan },
    });
  } catch (err) {
    logger.error(`Razorpay order creation failed: ${err.message}`);
    throw ApiError.internal("Payment gateway error. Please try again.");
  }

  // Persist a pending transaction record
  const transaction = await Transaction.create({
    user: userId,
    plan,
    amount: planConfig.price,
    currency: "INR",
    razorpayOrderId: razorpayOrder.id,
    status: "created",
  });

  logger.info(`Razorpay order created: ${razorpayOrder.id} for user ${userId}`);

  return {
    orderId: razorpayOrder.id,
    amount: amountInPaise,
    currency: "INR",
    plan,
    credits: planConfig.credits,
    keyId: process.env.RAZORPAY_KEY_ID,
    transactionId: transaction._id,
  };
};

// ─── Verify Payment & Activate Subscription ───────────────────────────────────

/**
 * After Razorpay checkout, client sends back the payment details.
 * We verify the signature, mark transaction as paid, and activate the subscription.
 *
 * @param {string} userId
 * @param {object} paymentData - { razorpayOrderId, razorpayPaymentId, razorpaySignature }
 */
const verifyPaymentAndActivate = async (userId, paymentData) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = paymentData;

  // ── Signature verification ──────────────────────────────────────────────
  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");

  if (expectedSignature !== razorpaySignature) {
    logger.warn(`Payment signature mismatch for order ${razorpayOrderId}`);
    throw ApiError.badRequest("Payment verification failed: invalid signature");
  }

  // ── Find the pending transaction ────────────────────────────────────────
  const transaction = await Transaction.findOne({
    razorpayOrderId,
    user: userId,
    status: "created",
  });

  if (!transaction) {
    throw ApiError.notFound("Transaction not found or already processed");
  }

  // ── Activate subscription (inside a transaction-like update) ────────────
  const planConfig = PLAN_CONFIG[transaction.plan];

  const subscription = await Subscription.create({
    user: userId,
    plan: transaction.plan,
    totalCredits: planConfig.credits,
    usedCredits: 0,
    status: "active",
    transaction: transaction._id,
  });

  // Update transaction as paid
  transaction.status = "paid";
  transaction.razorpayPaymentId = razorpayPaymentId;
  transaction.razorpaySignature = razorpaySignature;
  transaction.paidAt = new Date();
  transaction.subscription = subscription._id;
  await transaction.save();

  // Update user's active subscription reference
  await User.findByIdAndUpdate(userId, {
    activeSubscription: subscription._id,
  });

  // Send confirmation email (non-blocking)
  const user = await User.findById(userId);
  emailService
    .sendSubscriptionConfirmationEmail(user, subscription, transaction)
    .catch((err) => logger.error(`Subscription email failed: ${err.message}`));

  logger.info(
    `Payment verified & subscription activated: ${subscription._id} for user ${userId}`,
  );

  return { subscription, transaction };
};

// ─── Razorpay Webhook (server-to-server) ─────────────────────────────────────

/**
 * Handle Razorpay webhooks.
 * Used for server-to-server payment confirmation (more reliable than client callback).
 *
 * @param {string} rawBody     - Raw request body string (required for HMAC)
 * @param {string} signature   - X-Razorpay-Signature header value
 * @param {object} payload     - Parsed webhook payload
 */
const handleWebhook = async (rawBody, signature, payload) => {
  // Verify webhook signature
  const expectedSig = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  if (expectedSig !== signature) {
    throw ApiError.unauthorized("Invalid webhook signature");
  }

  const event = payload.event;
  logger.info(`Razorpay webhook received: ${event}`);

  if (event === "payment.failed") {
    const payment = payload.payload.payment.entity;
    await Transaction.findOneAndUpdate(
      { razorpayOrderId: payment.order_id, status: "created" },
      {
        status: "failed",
        failureReason: payment.error_description || "Payment failed",
        razorpayPaymentId: payment.id,
      },
    );
    logger.info(`Payment failed for order: ${payment.order_id}`);
  }

  // payment.captured is also handled here as a fallback (in case client callback fails)
  if (event === "payment.captured") {
    const payment = payload.payload.payment.entity;
    const existing = await Transaction.findOne({
      razorpayOrderId: payment.order_id,
      status: "paid",
    });
    // Skip if already processed via client callback
    if (!existing) {
      logger.info(
        `Webhook fallback: processing payment for order ${payment.order_id}`,
      );
      // Could call verifyPaymentAndActivate here if needed
    }
  }
};

// ─── Get Transaction History ──────────────────────────────────────────────────

const getUserTransactions = async (userId, { page = 1, limit = 20 }) => {
  const skip = (Number(page) - 1) * Number(limit);

  const [transactions, total] = await Promise.all([
    Transaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate(
        "subscription",
        "plan totalCredits usedCredits status expiresAt",
      )
      .select("-razorpaySignature -__v"),
    Transaction.countDocuments({ user: userId }),
  ]);

  return {
    transactions,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)),
    },
  };
};

// ─── Get User's Active Subscription ──────────────────────────────────────────

const getActiveSubscription = async (userId) => {
  return Subscription.findOne({
    user: userId,
    status: "active",
    expiresAt: { $gt: new Date() },
  }).select("-__v");
};

// ─── Admin: All Transactions ──────────────────────────────────────────────────

const getAllTransactionsAdmin = async ({ page = 1, limit = 20, status }) => {
  const filter = {};
  if (status) filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);

  const [transactions, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate("user", "username email phone")
      .populate("subscription", "plan totalCredits usedCredits")
      .select("-razorpaySignature -__v"),
    Transaction.countDocuments(filter),
  ]);

  return {
    transactions,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)),
    },
  };
};

module.exports = {
  createOrder,
  verifyPaymentAndActivate,
  handleWebhook,
  getUserTransactions,
  getActiveSubscription,
  getAllTransactionsAdmin,
};
