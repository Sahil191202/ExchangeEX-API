# OLX Platform — API Documentation

**Base URL**: `http://localhost:5000/api`  
**Auth**: Bearer token in `Authorization: Bearer <accessToken>` header  
**Content-Type**: `application/json`

---

## Authentication

### POST `/auth/register`
Register a new user with email + password.

**Body**
```json
{
  "username": "john_doe",
  "email": "john@example.com",
  "phone": "+919876543210",
  "password": "SecurePass123"
}
```
**Response 201**
```json
{
  "success": true,
  "data": {
    "user": { "_id": "...", "username": "john_doe", "email": "john@example.com" },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  },
  "message": "Registration successful. Please verify your email."
}
```

---

### POST `/auth/login`
Login with email or phone + password.

**Body**
```json
{ "email": "john@example.com", "password": "SecurePass123" }
```
or
```json
{ "phone": "+919876543210", "password": "SecurePass123" }
```

---

### POST `/auth/phone-login`
Login/register via Firebase Phone OTP.

**Flow**:
1. Client collects phone number and initiates Firebase OTP
2. User enters OTP on client → Firebase returns an ID token
3. Client sends that ID token here

**Body**
```json
{
  "phone": "+919876543210",
  "firebaseIdToken": "<firebase_id_token>"
}
```

---

### POST `/auth/google`
Login/register via Google OAuth.

**Body**
```json
{ "idToken": "<google_id_token>" }
```

---

### POST `/auth/refresh`
Rotate access + refresh tokens.

**Body**
```json
{ "refreshToken": "eyJ..." }
```

---

### GET `/auth/verify-email?token=<token>`
Verify email address using the token sent in registration email.

---

### POST `/auth/logout` 🔒
Invalidate the server-side refresh token.

---

### GET `/auth/me` 🔒
Get authenticated user profile.

---

## Users

### GET `/users/profile` 🔒
Get own profile with active subscription info.

---

### PATCH `/users/profile` 🔒
Update profile fields.

**Body** (all optional, at least one required)
```json
{
  "username": "new_name",
  "email": "new@example.com",
  "phone": "+919999999999",
  "location": { "city": "Mumbai", "state": "Maharashtra" }
}
```

---

### PATCH `/users/profile-picture` 🔒
Upload profile picture.

**Content-Type**: `multipart/form-data`  
**Field**: `profilePicture` (max 2MB, jpg/png/webp)

---

### PATCH `/users/change-password` 🔒
Change password.

**Body**
```json
{ "currentPassword": "OldPass123", "newPassword": "NewPass456" }
```

---

### GET `/users/:userId/public`
Get public profile of any user (for seller info on listings).

---

## Listings

### GET `/listings`
Get all approved listings with filters.

**Query Parameters**

| Param      | Type   | Default  | Description                                     |
|------------|--------|----------|-------------------------------------------------|
| `page`     | number | 1        | Page number                                     |
| `limit`    | number | 20       | Items per page (max 50)                         |
| `category` | string | -        | electronics, vehicles, furniture, real-estate…  |
| `minPrice` | number | -        | Minimum price filter                            |
| `maxPrice` | number | -        | Maximum price filter                            |
| `city`     | string | -        | Filter by city (case-insensitive)               |
| `search`   | string | -        | Full-text search in title and description       |
| `sort`     | string | newest   | newest, oldest, price-asc, price-desc           |
| `condition`| string | -        | new, like-new, good, fair, poor                 |

---

### GET `/listings/:id`
Get a single listing by ID. Increments view count.

---

### POST `/listings` 🔒
Create a new listing.

**Content-Type**: `multipart/form-data`

**Fields**

| Field          | Type    | Required | Description                           |
|----------------|---------|----------|---------------------------------------|
| `title`        | string  | ✅        | 10–100 chars                          |
| `description`  | string  | ✅        | 20–2000 chars                         |
| `category`     | string  | ✅        | See categories above                  |
| `price`        | number  | ✅        | ≥ 0                                   |
| `contactPhone` | string  | ✅        | International format e.g. +91...      |
| `condition`    | string  | ❌        | new/like-new/good/fair/poor           |
| `isNegotiable` | boolean | ❌        | Default: true                         |
| `location`     | object  | ✅        | `{ address, city, state }`            |
| `images`       | files   | ❌        | Up to 10 images (max 5MB each)        |

**Subscription Logic**:
- First listing: always free
- Subsequent: requires active subscription (purchase via `/payments/create-order`)

---

### GET `/listings/my` 🔒
Get own listings. Supports `?status=pending|approved|rejected|sold`.

---

### PATCH `/listings/:id` 🔒
Update a listing (seller only). Sends back to `pending` for re-approval.

---

### DELETE `/listings/:id` 🔒
Delete own listing and its Cloudinary images.

---

### DELETE `/listings/:id/images/:publicId` 🔒
Remove a single image from a listing.

---

### PATCH `/listings/:id/sold` 🔒
Mark listing as sold.

---

## Payments & Subscriptions

### POST `/payments/create-order` 🔒
Create a Razorpay checkout order.

**Body**
```json
{ "plan": "single" }
```
or
```json
{ "plan": "bundle" }
```

**Plans**

| Plan     | Price | Credits |
|----------|-------|---------|
| `single` | ₹50   | 1       |
| `bundle` | ₹400  | 10      |

**Response**
```json
{
  "data": {
    "orderId": "order_xyz",
    "amount": 5000,
    "currency": "INR",
    "keyId": "rzp_test_...",
    "plan": "single",
    "credits": 1
  }
}
```

---

### POST `/payments/verify` 🔒
Verify payment after Razorpay checkout and activate subscription.

**Body**
```json
{
  "razorpayOrderId": "order_xyz",
  "razorpayPaymentId": "pay_abc",
  "razorpaySignature": "<hmac_signature>"
}
```

---

### GET `/payments/transactions` 🔒
Get own transaction history. Supports `?page=&limit=`.

---

### GET `/payments/subscription` 🔒
Get current active subscription with remaining credits.

---

### POST `/payments/webhook`
Razorpay webhook (server-to-server, no auth required — verified via HMAC).

---

## Chat

### POST `/chats` 🔒
Start or retrieve a chat for a listing.

**Body**
```json
{ "listingId": "<listing_id>" }
```

---

### GET `/chats` 🔒
Get all chats for the authenticated user (as buyer or seller).

---

### GET `/chats/:chatId/messages` 🔒
Get paginated messages. Marks unread messages as read. Supports `?page=&limit=`.

---

### DELETE `/chats/:chatId` 🔒
Soft-delete a chat from your view.

---

## Admin Routes 🔒👑 (admin role required)

### GET `/admin/stats`
Platform overview: total users, listings, pending reviews, revenue.

---

### GET `/admin/users`
List all users. Supports `?role=&isBanned=&search=&page=&limit=`.

---

### GET `/admin/users/:userId`
Get detailed user info with listing count and subscription.

---

### PATCH `/admin/users/:userId/ban`
Ban a user.

**Body**
```json
{ "reason": "Fraudulent listings" }
```

---

### PATCH `/admin/users/:userId/unban`
Lift a ban.

---

### PATCH `/admin/users/:userId/role`
Change user role.

**Body**
```json
{ "role": "admin" }
```

---

### GET `/admin/listings`
All listings (all statuses). Supports `?status=&category=&page=&limit=`.

---

### PATCH `/admin/listings/:id/review`
Approve or reject a pending listing.

**Body**
```json
{ "action": "approve" }
```
or
```json
{ "action": "reject", "reason": "Prohibited item in description" }
```

---

### PATCH `/admin/listings/:id/remove`
Force-remove a listing.

---

### GET `/admin/transactions`
All platform transactions. Supports `?status=created|paid|failed&page=&limit=`.

---

## Socket.io Events

**Connection**: `ws://localhost:5000` with `auth: { token: "<accessToken>" }`

### Client → Server

| Event           | Payload                              | Description                    |
|-----------------|--------------------------------------|--------------------------------|
| `chat:join`     | `chatId`                             | Join a chat room               |
| `chat:leave`    | `chatId`                             | Leave a chat room              |
| `message:send`  | `{ chatId, text, type?, offerAmount? }` | Send a message              |
| `message:read`  | `{ chatId, messageId }`              | Mark message as read           |
| `typing:start`  | `{ chatId }`                         | Start typing indicator         |
| `typing:stop`   | `{ chatId }`                         | Stop typing indicator          |
| `user:check_online` | `{ targetUserId }`               | Check if a user is online      |

### Server → Client

| Event                    | Payload                              | Description                  |
|--------------------------|--------------------------------------|------------------------------|
| `chat:joined`            | `{ chatId }`                         | Confirmed room join          |
| `message:new`            | `{ message }`                        | New message in room          |
| `message:status`         | `{ messageId, status, readAt? }`     | Delivery/read receipt        |
| `typing:started`         | `{ userId, chatId }`                 | Other user is typing         |
| `typing:stopped`         | `{ userId, chatId }`                 | Other user stopped typing    |
| `user:online`            | `{ userId }`                         | User came online             |
| `user:offline`           | `{ userId }`                         | User went offline            |
| `user:online_status`     | `{ userId, isOnline }`               | Response to check_online     |
| `notification:new_message` | `{ chatId, senderId, preview }`    | Push when not in chat room   |
| `error`                  | `{ message }`                        | Socket-level error           |

---

## Error Response Format

All errors follow this structure:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "email must be a valid email" }
  ]
}
```

| Status | Meaning                        |
|--------|--------------------------------|
| 400    | Bad request / validation error |
| 401    | Unauthorized (no/bad token)    |
| 403    | Forbidden (wrong role/banned)  |
| 404    | Resource not found             |
| 409    | Conflict (duplicate)           |
| 429    | Rate limit exceeded            |
| 500    | Internal server error          |