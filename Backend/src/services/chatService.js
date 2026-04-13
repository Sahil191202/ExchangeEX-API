const { Chat, Message } = require('../models/Chat');
const { Listing } = require('../models/Listing');
const { ApiError } = require('../utils/apiHelpers');
const logger = require('../utils/logger');

// ─── Get or Create Chat ───────────────────────────────────────────────────────

/**
 * Find an existing chat for (listing, buyer) or create a new one.
 * Seller is derived from the listing document.
 *
 * @param {string} listingId
 * @param {string} buyerId
 */
const getOrCreateChat = async (listingId, buyerId) => {
  const listing = await Listing.findById(listingId).select('seller title status');
  if (!listing) throw ApiError.notFound('Listing not found');
  if (listing.status !== 'approved') throw ApiError.badRequest('Cannot start chat for an unapproved listing');

  const sellerId = listing.seller.toString();

  if (sellerId === buyerId.toString()) {
    throw ApiError.badRequest('You cannot chat with yourself on your own listing');
  }

  // Upsert: find existing or create new
  let chat = await Chat.findOne({ listing: listingId, buyer: buyerId });

  if (!chat) {
    chat = await Chat.create({
      listing: listingId,
      buyer: buyerId,
      seller: sellerId,
    });
    logger.info(`New chat created: ${chat._id} for listing ${listingId}`);
  }

  return Chat.findById(chat._id)
    .populate('listing', 'title images price')
    .populate('buyer', 'username profilePicture')
    .populate('seller', 'username profilePicture');
};

// ─── Get User's Chat List ─────────────────────────────────────────────────────

/**
 * Fetch all chats for a user (as buyer or seller), sorted by last activity.
 */
const getUserChats = async (userId, { page = 1, limit = 20 }) => {
  const skip = (Number(page) - 1) * Number(limit);

  const filter = {
    $or: [{ buyer: userId }, { seller: userId }],
    isActive: true,
  };

  const [chats, total] = await Promise.all([
    Chat.find(filter)
      .sort({ lastMessageAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('listing', 'title images price status')
      .populate('buyer', 'username profilePicture')
      .populate('seller', 'username profilePicture'),
    Chat.countDocuments(filter),
  ]);

  // Attach unread count from the perspective of the requesting user
  const enriched = chats.map((chat) => {
    const isBuyer = chat.buyer._id.toString() === userId.toString();
    return {
      ...chat.toJSON(),
      unreadCount: isBuyer ? chat.buyerUnread : chat.sellerUnread,
    };
  });

  return {
    chats: enriched,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
  };
};

// ─── Get Messages in a Chat ───────────────────────────────────────────────────

/**
 * Fetch paginated messages for a chat, oldest-first (for rendering in order).
 * Also marks all unread messages as read for the requesting user.
 */
const getChatMessages = async (chatId, userId, { page = 1, limit = 50 }) => {
  const chat = await Chat.findById(chatId);
  if (!chat) throw ApiError.notFound('Chat not found');

  // Authorization: only buyer or seller can read messages
  const isBuyer = chat.buyer.toString() === userId.toString();
  const isSeller = chat.seller.toString() === userId.toString();
  if (!isBuyer && !isSeller) throw ApiError.forbidden('Not authorized to view this chat');

  const skip = (Number(page) - 1) * Number(limit);

  const [messages, total] = await Promise.all([
    Message.find({ chat: chatId, isDeleted: false })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('sender', 'username profilePicture'),
    Message.countDocuments({ chat: chatId, isDeleted: false }),
  ]);

  // Mark messages as read (sent by the other party)
  const now = new Date();
  await Message.updateMany(
    { chat: chatId, sender: { $ne: userId }, status: { $in: ['sent', 'delivered'] } },
    { status: 'read', readAt: now }
  );

  // Reset unread count for the requesting user
  const unreadUpdate = isBuyer ? { buyerUnread: 0 } : { sellerUnread: 0 };
  await Chat.findByIdAndUpdate(chatId, unreadUpdate);

  return {
    messages,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
  };
};

// ─── Save a Message (called by Socket.io handler) ────────────────────────────

/**
 * Persist a new message and update the chat's last message metadata.
 *
 * @param {string} chatId
 * @param {string} senderId
 * @param {object} messageData - { text, type, offerAmount, imageUrl, imagePublicId }
 */
const saveMessage = async (chatId, senderId, messageData) => {
  const chat = await Chat.findById(chatId);
  if (!chat || !chat.isActive) throw ApiError.notFound('Chat not found or inactive');

  const isBuyer = chat.buyer.toString() === senderId.toString();
  const isSeller = chat.seller.toString() === senderId.toString();
  if (!isBuyer && !isSeller) throw ApiError.forbidden('Not a participant of this chat');

  const message = await Message.create({
    chat: chatId,
    sender: senderId,
    ...messageData,
    status: 'sent',
  });

  // Update chat metadata
  const unreadIncrement = isBuyer ? { sellerUnread: 1 } : { buyerUnread: 1 };
  await Chat.findByIdAndUpdate(chatId, {
    lastMessage: messageData.text || (messageData.type === 'image' ? '📷 Image' : `Offer: ₹${messageData.offerAmount}`),
    lastMessageAt: new Date(),
    $inc: unreadIncrement,
  });

  return Message.findById(message._id).populate('sender', 'username profilePicture');
};

// ─── Update Message Status ────────────────────────────────────────────────────

const updateMessageStatus = async (messageId, status) => {
  const update = { status };
  if (status === 'delivered') update.deliveredAt = new Date();
  if (status === 'read') update.readAt = new Date();

  return Message.findByIdAndUpdate(messageId, update, { new: true });
};

// ─── Delete Chat (soft delete) ────────────────────────────────────────────────

const deleteChat = async (chatId, userId) => {
  const chat = await Chat.findById(chatId);
  if (!chat) throw ApiError.notFound('Chat not found');

  const isBuyer = chat.buyer.toString() === userId.toString();
  const isSeller = chat.seller.toString() === userId.toString();
  if (!isBuyer && !isSeller) throw ApiError.forbidden('Not authorized');

  const update = isBuyer ? { deletedByBuyer: true } : { deletedBySeller: true };

  // If both parties deleted, mark as inactive
  const updated = await Chat.findByIdAndUpdate(chatId, update, { new: true });
  if (updated.deletedByBuyer && updated.deletedBySeller) {
    await Chat.findByIdAndUpdate(chatId, { isActive: false });
  }
};

module.exports = {
  getOrCreateChat,
  getUserChats,
  getChatMessages,
  saveMessage,
  updateMessageStatus,
  deleteChat,
};