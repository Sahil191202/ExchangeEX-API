# ExchangeEX Platform — API Documentation

**Base URL**: `http://localhost:5000/api`  
**Auth**: `Authorization: Bearer <accessToken>` header on all 🔒 routes  
**Content-Type**: `application/json` (except file uploads which use `multipart/form-data`)

> **No passwords.** Authentication is entirely passwordless — Phone OTP via Firebase, Email OTP, or Google OAuth.

---

## Authentication

### Auth flows overview

| Flow | Endpoints |
|---|---|
| Email OTP | `POST /auth/email/send-otp` → `POST /auth/email/verify-otp` |
| Phone OTP (Firebase) | Client handles SMS with Firebase SDK → `POST /auth/phone/verify` |
| Google OAuth | Client gets Google ID token → `POST /auth/google` |

---

### POST `/auth/email/send-otp`
Request a 6-digit OTP to be sent to an email address.  
Creates a stub account on first use (completed after verification).

**Body**
```json
{ "email": "john@example.com" }
```

**Response 200**
```json
{
  "success": true,
  "data": { "message": "OTP sent" },
  "message": "OTP sent to john@example.com. Valid for 10 minutes."
}
```

> In `NODE_ENV=development` the response also includes `_devOtp` so you can test without SMTP.

**Rate limit**: 3 requests per minute per IP (prevents email/SMS abuse).

---

### POST `/auth/email/verify-otp`
Submit the 6-digit OTP. On success returns a JWT access + refresh token pair.

**Body**
```json
{
  "email": "john@example.com",
  "otp": "482951"
}
```

**Response 200**
```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "username": "user_a1b2c3d4",
      "email": "john@example.com",
      "isEmailVerified": true,
      "role": "user"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  "message": "Email verified. Login successful."
}
```

> OTP expires after **10 minutes**. Request a new one with `send-otp` if expired.

---

### POST `/auth/phone/verify`
Complete phone OTP login using a Firebase ID token.

**Firebase flow (client-side first):**
1. Client calls `firebase.auth().signInWithPhoneNumber(phone)` — Firebase sends the SMS
2. User enters the OTP on the client
3. Client calls `confirmationResult.confirm(otp)` — Firebase returns an ID token
4. Client sends that ID token here

**Body**
```json
{
  "phone": "+919876543210",
  "firebaseIdToken": "<id_token_from_firebase_sdk>"
}
```

**Response 200**
```json
{
  "success": true,
  "data": {
    "user": { "_id": "...", "phone": "+919876543210", "isPhoneVerified": true },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "isNewUser": true
  },
  "message": "Phone verified. Please complete your profile."
}
```

> `isNewUser: true` means the client should redirect to the complete-profile screen so the user can set a proper username and optionally add their email.

---

### POST `/auth/google`
Login or register using a Google ID token from the client.

**Body**
```json
{ "idToken": "<google_id_token_from_client>" }
```

**Response 200**
```json
{
  "success": true,
  "data": {
    "user": { "_id": "...", "email": "john@gmail.com", "isEmailVerified": true },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  },
  "message": "Google login successful."
}
```

---

### POST `/auth/refresh`
Exchange a valid refresh token for a new access + refresh token pair.  
Old refresh token is invalidated immediately (rotation with reuse detection).

**Body**
```json
{ "refreshToken": "eyJ..." }
```

**Response 200**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  },
  "message": "Tokens refreshed."
}
```

---

### POST `/auth/logout` 🔒
Invalidate the server-side refresh token. The access token becomes unusable on next refresh.

No body required.

---

### GET `/auth/me` 🔒
Get the currently authenticated user's profile.

---

### PATCH `/auth/complete-profile` 🔒
Set a real username (and optionally add an email) after a first phone OTP registration.  
At least one field required.

**Body**
```json
{
  "username": "john_doe",
  "email": "john@example.com"
}
```

> If `email` is provided, it will be marked unverified — the user must go through the Email OTP flow to verify it.

---

## Users

### GET `/users/profile` 🔒
Get own profile including active subscription details.

**Response 200**
```json
{
  "data": {
    "user": {
      "_id": "...",
      "username": "john_doe",
      "email": "john@example.com",
      "phone": "+919876543210",
      "profilePicture": { "url": "https://res.cloudinary.com/...", "publicId": "olx/profiles/..." },
      "role": "user",
      "isEmailVerified": true,
      "isPhoneVerified": false,
      "freeListingUsed": false,
      "location": { "city": "Mumbai", "state": "Maharashtra", "country": "India" },
      "activeSubscription": {
        "plan": "bundle",
        "totalCredits": 10,
        "usedCredits": 2,
        "status": "active",
        "expiresAt": "2026-01-01T00:00:00.000Z"
      }
    }
  }
}
```

---

### PATCH `/users/profile` 🔒
Update editable profile fields. At least one field required.

If `email` is changed → marked unverified, must re-verify via Email OTP.  
If `phone` is changed → marked unverified, must re-verify via Firebase OTP.

**Body** (all optional, at least one required)
```json
{
  "username": "new_username",
  "email": "new@example.com",
  "phone": "+919999999999",
  "location": {
    "city": "Bangalore",
    "state": "Karnataka",
    "country": "India"
  }
}
```

---

### PATCH `/users/profile-picture` 🔒
Replace profile picture. Old image is deleted from Cloudinary automatically.

**Content-Type**: `multipart/form-data`  
**Field**: `profilePicture` — image file (max 2MB, jpg/png/webp)

---

### GET `/users/:userId/public`
Get the public profile of any user (used on listing detail pages to show seller info).

**Response 200**
```json
{
  "data": {
    "user": {
      "_id": "...",
      "username": "john_doe",
      "profilePicture": { "url": "..." },
      "location": { "city": "Mumbai" },
      "isEmailVerified": true,
      "createdAt": "2024-01-15T10:00:00.000Z"
    }
  }
}
```

---

## Listings

### GET `/listings`
Browse all approved listings. No auth required.

**Query Parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page (max 50) |
| `category` | string | — | electronics, vehicles, furniture, real-estate, fashion, books, sports, toys, jobs, services, pets, other |
| `minPrice` | number | — | Minimum price |
| `maxPrice` | number | — | Maximum price |
| `city` | string | — | City filter (case-insensitive) |
| `search` | string | — | Full-text search across title + description |
| `sort` | string | newest | newest, oldest, price-asc, price-desc |
| `condition` | string | — | new, like-new, good, fair, poor |

**Example**
```
GET /listings?category=electronics&city=Mumbai&minPrice=5000&maxPrice=80000&sort=price-asc&page=1
```

---

### GET `/listings/:id`
Get a single approved listing. Increments view count on each call.

---

### GET `/listings/my` 🔒
Get the authenticated user's own listings (all statuses).

**Query**: `?status=pending|approved|rejected|sold|removed&page=1&limit=20`

---

### POST `/listings` 🔒
Create a new listing. Uses `multipart/form-data` to support image uploads.

**Subscription logic:**
- First listing ever → always free
- All subsequent listings → requires an active subscription with remaining credits
- Purchase a subscription at `POST /payments/create-order`

**Form fields**

| Field | Type | Required | Validation |
|---|---|---|---|
| `title` | string | ✅ | 10–100 chars |
| `description` | string | ✅ | 20–2000 chars |
| `category` | string | ✅ | See category list above |
| `price` | number | ✅ | ≥ 0 |
| `contactPhone` | string | ✅ | International format e.g. +91... |
| `condition` | string | ❌ | new / like-new / good / fair / poor (default: good) |
| `isNegotiable` | boolean | ❌ | Default: true |
| `location[address]` | string | ✅ | — |
| `location[city]` | string | ✅ | — |
| `location[state]` | string | ✅ | — |
| `location[country]` | string | ❌ | Default: India |
| `location[pincode]` | string | ❌ | — |
| `images` | file(s) | ❌ | Up to 10 images, max 5MB each, jpg/png/webp |

**Response 201**
```json
{
  "data": {
    "listing": {
      "_id": "64f1...",
      "title": "iPhone 14 Pro 256GB",
      "status": "pending",
      "seller": "64f0..."
    }
  },
  "message": "Listing submitted for review. You will be notified once approved."
}
```

> Newly created listings have `status: "pending"` and are not publicly visible until an admin approves them.

---

### PATCH `/listings/:id` 🔒
Update a listing (seller only). Any update sends the listing back to `pending` status for re-approval.

Same fields as POST (all optional, at least one required). Supports additional image uploads via `images` file field.

---

### DELETE `/listings/:id` 🔒
Permanently delete own listing and all its Cloudinary images.

---

### DELETE `/listings/:id/images/:publicId` 🔒
Remove a single image from a listing by its Cloudinary `publicId`.

> Cannot delete the last remaining image — upload a new one first.

---

### PATCH `/listings/:id/sold` 🔒
Mark a listing as sold. Only the seller can do this.

---

## Payments & Subscriptions

### POST `/payments/create-order` 🔒
Initiate a Razorpay checkout session.

**Body**
```json
{ "plan": "single" }
```
or
```json
{ "plan": "bundle" }
```

**Plans**

| Plan | Price | Listing credits | Validity |
|---|---|---|---|
| `single` | ₹50 | 1 | 1 year |
| `bundle` | ₹400 | 10 | 1 year |

**Response 201**
```json
{
  "data": {
    "orderId": "order_PqrStUvWxYz",
    "amount": 5000,
    "currency": "INR",
    "keyId": "rzp_test_...",
    "plan": "single",
    "credits": 1,
    "transactionId": "64f2..."
  }
}
```

Use `orderId` and `keyId` to open the Razorpay checkout widget in the client.

---

### POST `/payments/verify` 🔒
Verify the payment signature after Razorpay checkout completes and activate the subscription.

**Body**
```json
{
  "razorpayOrderId": "order_PqrStUvWxYz",
  "razorpayPaymentId": "pay_AbCdEfGhIj",
  "razorpaySignature": "<hmac_sha256_signature>"
}
```

These three values are returned by the Razorpay checkout `handler` callback on the client.

**Response 200**
```json
{
  "data": {
    "subscription": {
      "_id": "...",
      "plan": "single",
      "totalCredits": 1,
      "usedCredits": 0,
      "status": "active",
      "expiresAt": "2026-01-01T00:00:00.000Z"
    },
    "transaction": {
      "_id": "...",
      "amount": 50,
      "status": "paid",
      "paidAt": "2025-01-01T10:00:00.000Z"
    }
  },
  "message": "Payment verified. Subscription activated!"
}
```

---

### GET `/payments/subscription` 🔒
Get the current active subscription including remaining credits.

---

### GET `/payments/transactions` 🔒
Get own transaction history. Supports `?page=&limit=`.

---

### POST `/payments/webhook`
Razorpay server-to-server webhook. No JWT required — verified via `X-Razorpay-Signature` HMAC header.  
Configure this URL in your Razorpay dashboard under Webhooks.

---

## Chat

### POST `/chats` 🔒
Start a new chat or retrieve an existing one for a listing.  
Seller is derived automatically from the listing — you cannot start a chat on your own listing.

**Body**
```json
{ "listingId": "64f1..." }
```

**Response 200**
```json
{
  "data": {
    "chat": {
      "_id": "64f3...",
      "listing": { "_id": "...", "title": "iPhone 14 Pro", "price": 65000 },
      "buyer":  { "_id": "...", "username": "buyer_user" },
      "seller": { "_id": "...", "username": "seller_user" },
      "lastMessage": "",
      "buyerUnread": 0,
      "sellerUnread": 0
    }
  }
}
```

---

### GET `/chats` 🔒
Get all chats for the authenticated user (as buyer or seller), sorted by last activity.

---

### GET `/chats/:chatId/messages` 🔒
Get paginated messages for a chat. Also marks all unread messages as read for the caller.

**Query**: `?page=1&limit=50`

---

### DELETE `/chats/:chatId` 🔒
Soft-delete a chat from the caller's view. If both parties delete, the chat is fully deactivated.

---

## Admin Routes 🔒 (admin role required)

> To become an admin: update your user document in MongoDB — `db.users.updateOne({email:"..."}, {$set:{role:"admin"}})` — then log in again for a new token.

---

### GET `/admin/stats`
Platform overview dashboard data.

**Response 200**
```json
{
  "data": {
    "totalUsers": 1240,
    "totalListings": 5830,
    "pendingListings": 14,
    "totalTransactions": 390,
    "totalRevenue": 18250,
    "newUsersToday": 8
  }
}
```

---

### GET `/admin/users`
List all users. Supports `?role=user|admin&isBanned=true|false&search=<text>&page=&limit=`.

---

### GET `/admin/users/:userId`
Get full user details including listing count and active subscription.

---

### PATCH `/admin/users/:userId/ban`
Ban a user. They will receive a `403 Forbidden` on their next authenticated request.

**Body**
```json
{ "reason": "Posted fraudulent listings repeatedly." }
```

---

### PATCH `/admin/users/:userId/unban`
Lift a ban. No body required.

---

### PATCH `/admin/users/:userId/role`
Promote or demote a user.

**Body**
```json
{ "role": "admin" }
```

---

### GET `/admin/listings`
All listings across all statuses. Supports `?status=pending|approved|rejected|sold|removed&category=&page=&limit=`.

---

### PATCH `/admin/listings/:id/review`
Approve or reject a pending listing. Triggers an email notification to the seller.

**Approve**
```json
{ "action": "approve" }
```

**Reject** (reason required)
```json
{
  "action": "reject",
  "reason": "Item description contains prohibited content."
}
```

---

### PATCH `/admin/listings/:id/remove`
Force-remove any listing regardless of status. No body required.

---

### GET `/admin/transactions`
All platform transactions. Supports `?status=created|paid|failed&page=&limit=`.

---

## Socket.io — Real-time Chat

**Connect**: `ws://localhost:5000`  
**Auth**: pass the JWT in the handshake — `socket = io(url, { auth: { token: accessToken } })`

### Events: Client → Server

| Event | Payload | Description |
|---|---|---|
| `chat:join` | `chatId` (string) | Join a chat room to receive messages |
| `chat:leave` | `chatId` (string) | Leave a chat room |
| `message:send` | `{ chatId, text, type?, offerAmount? }` | Send a message. `type`: text / image / offer |
| `message:read` | `{ chatId, messageId }` | Mark a specific message as read |
| `typing:start` | `{ chatId }` | Broadcast "is typing" to the other participant |
| `typing:stop` | `{ chatId }` | Stop "is typing" indicator |
| `user:check_online` | `{ targetUserId }` | Check if another user is currently connected |

### Events: Server → Client

| Event | Payload | Description |
|---|---|---|
| `chat:joined` | `{ chatId }` | Acknowledgement of room join |
| `chat:participant_joined` | `{ userId, chatId }` | Other user entered the room |
| `chat:participant_left` | `{ userId, chatId }` | Other user left the room |
| `message:new` | `{ message }` | New message received in the room |
| `message:status` | `{ messageId, status, readAt? }` | Delivery or read receipt |
| `typing:started` | `{ userId, chatId }` | Other participant started typing |
| `typing:stopped` | `{ userId, chatId }` | Other participant stopped typing |
| `user:online` | `{ userId }` | A user connected |
| `user:offline` | `{ userId }` | A user disconnected |
| `user:online_status` | `{ userId, isOnline }` | Response to `user:check_online` |
| `notification:new_message` | `{ chatId, senderId, preview }` | Push notification when not in the room |
| `error` | `{ message }` | Socket-level error |

---

## Error Response Format

All errors — validation, auth, not found, server — use this consistent shape:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "email must be a valid email" },
    { "field": "otp",   "message": "OTP must be exactly 6 digits" }
  ]
}
```

`errors` array is only present for validation failures (400). For all other errors it is omitted.

| Status | Meaning |
|---|---|
| 400 | Bad request or validation error |
| 401 | Missing, expired, or invalid token |
| 403 | Forbidden — wrong role or account banned |
| 404 | Resource not found |
| 409 | Conflict — duplicate email, phone, username |
| 429 | Rate limit exceeded |
| 500 | Internal server error (details hidden in production) |