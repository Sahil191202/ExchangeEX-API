const express = require('express');

// ─── Admin Router ─────────────────────────────────────────────────────────────
const adminRouter = express.Router();
const adminController = require('../controllers/adminController');
const listingController = require('../controllers/listingController');
const { getAllTransactionsAdmin } = require('../controllers/paymentChatController');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

adminRouter.use(authenticate, authorize('admin'));

// User management
adminRouter.get('/users',                   adminController.getAllUsers);
adminRouter.get('/users/:userId',           adminController.getUserDetail);
adminRouter.patch('/users/:userId/ban',     validate(schemas.banUserSchema), adminController.banUser);
adminRouter.patch('/users/:userId/unban',   adminController.unbanUser);
adminRouter.patch('/users/:userId/role',    adminController.changeUserRole);

// Listing management
adminRouter.get('/listings',                listingController.getAllListingsAdmin);
adminRouter.patch('/listings/:id/review',   validate(schemas.approveRejectSchema), listingController.reviewListing);
adminRouter.patch('/listings/:id/remove',   listingController.removeListingAdmin);

// Transactions
adminRouter.get('/transactions',            getAllTransactionsAdmin);

// Platform stats
adminRouter.get('/stats',                   adminController.getPlatformStats);

// ─── Payment Router ───────────────────────────────────────────────────────────
const paymentRouter = express.Router();
const paymentController = require('../controllers/paymentChatController');
const express2 = require('express');

// Webhook needs raw body for HMAC verification — handled specially in app.js
paymentRouter.post('/webhook', express2.raw({ type: 'application/json' }), (req, res, next) => {
  req.rawBody = req.body.toString('utf8');
  req.body = JSON.parse(req.rawBody);
  next();
}, paymentController.webhook);

paymentRouter.use(authenticate); // all other payment routes require auth

paymentRouter.post('/create-order',   validate(schemas.createOrderSchema),   paymentController.createOrder);
paymentRouter.post('/verify',         validate(schemas.verifyPaymentSchema),  paymentController.verifyPayment);
paymentRouter.get('/transactions',    paymentController.getTransactions);
paymentRouter.get('/subscription',    paymentController.getActiveSubscription);

// ─── Chat Router ──────────────────────────────────────────────────────────────
const chatRouter = express.Router();
const chatController = require('../controllers/paymentChatController');

chatRouter.use(authenticate);

chatRouter.post('/',                       chatController.getOrCreateChat);
chatRouter.get('/',                        chatController.getUserChats);
chatRouter.get('/:chatId/messages',        chatController.getChatMessages);
chatRouter.delete('/:chatId',              chatController.deleteChat);

module.exports = { adminRouter, paymentRouter, chatRouter };