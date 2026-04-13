# ExchangeEX Platform — Production Backend

A production-ready classified ads platform backend built with Node.js, Express, and MongoDB.

## Features
- Passwordless authentication — Phone OTP (Firebase), Email OTP, Google OAuth
- JWT access + refresh token pair (server-side invalidation on logout)
- Role-based access control (user / admin)
- Listing CRUD with admin approval workflow
- Subscription system (₹50 / ₹400) via Razorpay
- Real-time one-to-one chat via Socket.io
- Email notifications via Nodemailer (OTP codes + listing status)
- Image uploads via Cloudinary (up to 10 per listing)
- Rate limiting, Helmet, CORS security

## Auth flows

| Method | How it works |
|---|---|
| Phone OTP | Client triggers Firebase SMS → user enters OTP → Firebase returns ID token → send to `/auth/phone/verify` |
| Email OTP | `POST /auth/email/send-otp` → 6-digit code sent to inbox → `POST /auth/email/verify-otp` |
| Google OAuth | Client gets Google ID token → send to `POST /auth/google` |

No password field exists anywhere in the system.

## Folder Structure

```
ExchangeEX-backend/
├── src/
│   ├── config/
│   │   ├── database.js          # MongoDB connection with retry logic
│   │   ├── firebase.js          # Firebase Admin SDK initializer
│   │   └── cloudinary.js        # Cloudinary + Multer storage setup
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── userController.js
│   │   ├── listingController.js
│   │   ├── adminController.js
│   │   └── paymentChatController.js
│   ├── middleware/
│   │   ├── auth.js              # JWT authenticate, authorize, optionalAuth guards
│   │   ├── errorHandler.js      # Global error handler + 404 catcher
│   │   └── validate.js          # Joi schemas + validate() middleware factory
│   ├── models/
│   │   ├── User.js              # Passwordless user schema
│   │   ├── Listing.js           # Listing with approval workflow + geospatial index
│   │   ├── Subscription.js      # Subscription + Transaction schemas
│   │   └── Chat.js              # Chat + Message schemas
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── userRoutes.js
│   │   ├── listingRoutes.js
│   │   └── index.js             # Admin + Payment + Chat routers
│   ├── services/
│   │   ├── authService.js       # All 3 auth flows + token rotation
│   │   ├── listingService.js    # CRUD + approval + subscription check
│   │   ├── paymentService.js    # Razorpay order + webhook + activation
│   │   ├── chatService.js       # Chat room + message persistence
│   │   └── emailService.js      # OTP email + listing notification templates
│   ├── socket/
│   │   └── socketServer.js      # Socket.io server with JWT middleware
│   ├── utils/
│   │   ├── apiHelpers.js        # ApiError, ApiResponse, asyncHandler
│   │   ├── jwt.js               # Token generation + verification
│   │   └── logger.js            # Winston daily-rotating logger
│   ├── app.js                   # Express app with all middleware + routes
│   └── server.js                # Entry point — DB, Firebase, HTTP, Socket.io
├── logs/                        # Auto-created by Winston
├── .env.example
├── API_DOCUMENTATION.md
└── package.json
```

## Quick Start

```bash
# 1. Install dependencies
cd ExchangeEX-backend
npm install

# 2. Configure environment
cp .env.example .env
# Open .env and fill in all values (see table below)

# 3. Start development server (auto-reloads on change)
npm run dev

# 4. Production
npm start
```

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|---|---|
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Min 32-char random string for access tokens |
| `JWT_REFRESH_SECRET` | Separate min 32-char string for refresh tokens |
| `FIREBASE_PROJECT_ID` | From Firebase project settings |
| `FIREBASE_PRIVATE_KEY` | Service account private key (keep the `\n` escapes) |
| `FIREBASE_CLIENT_EMAIL` | Service account email |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID |
| `SMTP_HOST / SMTP_USER / SMTP_PASS` | Email delivery credentials |
| `CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET` | Cloudinary account |
| `RAZORPAY_KEY_ID / KEY_SECRET / WEBHOOK_SECRET` | Razorpay test or live keys |

## Security Checklist
- [x] No passwords — fully passwordless auth
- [x] Email OTPs stored as bcrypt hash (never plaintext)
- [x] Refresh tokens stored as SHA-256 hash — reuse attack detection built in
- [x] JWT with issuer + audience validation
- [x] Firebase ID token verified server-side on every phone/Google login
- [x] Helmet security headers
- [x] CORS whitelist (configured via `CLIENT_URL` env var)
- [x] Global rate limiter + strict per-IP limiter on auth routes
- [x] OTP send endpoint limited to 3 requests/minute to prevent SMS/email abuse
- [x] Joi validation strips unknown fields on every request body
- [x] Razorpay webhook verified via HMAC-SHA256 signature
- [x] Mongoose validation on all schemas with meaningful error messages
- [x] Global error handler — stack traces never exposed in production
- [x] Graceful shutdown closes DB connection cleanly on SIGTERM

## Promote a user to admin (for testing)

There is no signup-as-admin endpoint by design. Promote via the MongoDB shell or Compass:

```js
db.users.updateOne(
  { email: "your@email.com" },
  { $set: { role: "admin" } }
)
```

Then log in again — the new JWT will carry the `admin` role.