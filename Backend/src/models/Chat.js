const mongoose = require('mongoose');

/**
 * Chat Schema — a conversation between a buyer and a seller about a listing.
 * One chat document per (listing, buyer) pair.
 */
const chatSchema = new mongoose.Schema(
  {
    // Listing the chat is about
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: true,
    },

    // The two participants
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Last message preview (for chat list UI)
    lastMessage: { type: String, default: '' },
    lastMessageAt: { type: Date, default: Date.now },

    // Unread counts per participant
    buyerUnread: { type: Number, default: 0 },
    sellerUnread: { type: Number, default: 0 },

    // Soft delete — if either party deletes the chat from their view
    deletedByBuyer: { type: Boolean, default: false },
    deletedBySeller: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Enforce uniqueness: one chat per (listing, buyer) pair
chatSchema.index({ listing: 1, buyer: 1 }, { unique: true });
chatSchema.index({ buyer: 1, lastMessageAt: -1 });
chatSchema.index({ seller: 1, lastMessageAt: -1 });

const Chat = mongoose.model('Chat', chatSchema);

// ─── Message Schema ───────────────────────────────────────────────────────────

const MESSAGE_TYPES = ['text', 'image', 'offer'];

/**
 * Message Schema — individual messages within a Chat.
 * Stored as a separate collection for efficient querying with pagination.
 */
const messageSchema = new mongoose.Schema(
  {
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Chat',
      required: true,
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Message content
    type: {
      type: String,
      enum: MESSAGE_TYPES,
      default: 'text',
    },

    text: {
      type: String,
      trim: true,
      maxlength: [1000, 'Message cannot exceed 1000 characters'],
    },

    // For image messages
    imageUrl: { type: String },
    imagePublicId: { type: String },

    // For offer messages
    offerAmount: { type: Number },

    // ─── Delivery status ───────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent',
    },

    deliveredAt: { type: Date },
    readAt: { type: Date },

    // Soft delete
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
messageSchema.index({ chat: 1, createdAt: 1 }); // for paginating messages in order
messageSchema.index({ sender: 1 });
messageSchema.index({ chat: 1, status: 1 }); // for unread count queries

const Message = mongoose.model('Message', messageSchema);

module.exports = { Chat, Message };