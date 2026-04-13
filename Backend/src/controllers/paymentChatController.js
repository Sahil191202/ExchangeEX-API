const paymentService = require('../services/paymentService');
const chatService = require('../services/chatService');
const { ApiResponse, asyncHandler } = require('../utils/apiHelpers');

// ══════════════════════════════════════════════════════════════════
//  PAYMENT CONTROLLER
// ══════════════════════════════════════════════════════════════════

/**
 * POST /api/payments/create-order
 * Create a Razorpay order to initiate checkout
 */
const createOrder = asyncHandler(async (req, res) => {
  const { plan } = req.body;
  const orderData = await paymentService.createOrder(req.user._id, plan);

  res.status(201).json(
    new ApiResponse(201, orderData, 'Order created. Complete the payment to activate your subscription.')
  );
});

/**
 * POST /api/payments/verify
 * Verify Razorpay payment signature and activate subscription
 */
const verifyPayment = asyncHandler(async (req, res) => {
  const { subscription, transaction } = await paymentService.verifyPaymentAndActivate(
    req.user._id,
    req.body
  );

  res.status(200).json(
    new ApiResponse(200, { subscription, transaction }, 'Payment verified. Subscription activated!')
  );
});

/**
 * POST /api/payments/webhook
 * Razorpay webhook endpoint (no auth — verified via signature)
 */
const webhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  // req.rawBody is set by the express.raw() middleware on this route
  await paymentService.handleWebhook(req.rawBody, signature, req.body);

  // Always respond 200 to Razorpay immediately
  res.status(200).json({ received: true });
});

/**
 * GET /api/payments/transactions
 * Get authenticated user's transaction history
 */
const getTransactions = asyncHandler(async (req, res) => {
  const result = await paymentService.getUserTransactions(req.user._id, req.query);

  res.status(200).json(
    new ApiResponse(200, result, 'Transaction history fetched')
  );
});

/**
 * GET /api/payments/subscription
 * Get user's current active subscription
 */
const getActiveSubscription = asyncHandler(async (req, res) => {
  const subscription = await paymentService.getActiveSubscription(req.user._id);

  res.status(200).json(
    new ApiResponse(200, { subscription }, subscription ? 'Active subscription found' : 'No active subscription')
  );
});

/**
 * GET /api/admin/transactions
 * Admin: all platform transactions
 */
const getAllTransactionsAdmin = asyncHandler(async (req, res) => {
  const result = await paymentService.getAllTransactionsAdmin(req.query);

  res.status(200).json(
    new ApiResponse(200, result, 'All transactions fetched')
  );
});

// ══════════════════════════════════════════════════════════════════
//  CHAT CONTROLLER
// ══════════════════════════════════════════════════════════════════

/**
 * POST /api/chats
 * Start or retrieve a chat for a listing
 * Body: { listingId }
 */
const getOrCreateChat = asyncHandler(async (req, res) => {
  const { listingId } = req.body;
  const chat = await chatService.getOrCreateChat(listingId, req.user._id);

  res.status(200).json(
    new ApiResponse(200, { chat }, 'Chat ready')
  );
});

/**
 * GET /api/chats
 * Get all chats for the authenticated user
 */
const getUserChats = asyncHandler(async (req, res) => {
  const result = await chatService.getUserChats(req.user._id, req.query);

  res.status(200).json(
    new ApiResponse(200, result, 'Chats fetched')
  );
});

/**
 * GET /api/chats/:chatId/messages
 * Get paginated messages for a chat (also marks them as read)
 */
const getChatMessages = asyncHandler(async (req, res) => {
  const result = await chatService.getChatMessages(
    req.params.chatId,
    req.user._id,
    req.query
  );

  res.status(200).json(
    new ApiResponse(200, result, 'Messages fetched')
  );
});

/**
 * DELETE /api/chats/:chatId
 * Soft-delete a chat from the user's view
 */
const deleteChat = asyncHandler(async (req, res) => {
  await chatService.deleteChat(req.params.chatId, req.user._id);

  res.status(200).json(
    new ApiResponse(200, null, 'Chat deleted')
  );
});

module.exports = {
  // Payment
  createOrder,
  verifyPayment,
  webhook,
  getTransactions,
  getActiveSubscription,
  getAllTransactionsAdmin,
  // Chat
  getOrCreateChat,
  getUserChats,
  getChatMessages,
  deleteChat,
};