# OLX Platform — Production Backend

A production-ready classified ads platform backend built with Node.js, Express, and MongoDB.

## Features
- JWT authentication (access + refresh tokens)
- Firebase Phone OTP login
- Google OAuth login
- Role-based access control (user / admin)
- Listing CRUD with admin approval workflow
- Subscription system (₹50 / ₹400) via Razorpay
- Real-time chat via Socket.io
- Email notifications via Nodemailer
- Image uploads via Cloudinary
- Rate limiting, Helmet, CORS security

## Folder Structure

```
olx-backend/
├── src/
│   ├── config/
│   │   ├── database.js          # MongoDB connection with retry
│   │   ├── firebase.js          # Firebase Admin SDK
│   │   └── cloudinary.js        # Cloudinary + Multer setup
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── userController.js
│   │   ├── listingController.js
│   │   ├── adminController.js
│   │   └── paymentChatController.js
│   ├── middleware/
│   │   ├── auth.js              # JWT auth + role guards
│   │   ├── errorHandler.js      # Global error handler + 404
│   │   └── validate.js          # Joi schemas + validate() factory
│   ├── models/
│   │   ├── User.js
│   │   ├── Listing.js
│   │   ├── Subscription.js      # Subscription + Transaction
│   │   └── Chat.js              # Chat + Message
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── userRoutes.js
│   │   ├── listingRoutes.js
│   │   └── index.js             # Admin + Payment + Chat routers
│   ├── services/
│   │   ├── authService.js
│   │   ├── listingService.js
│   │   ├── paymentService.js
│   │   ├── chatService.js
│   │   └── emailService.js
│   ├── socket/
│   │   └── socketServer.js      # Socket.io server
│   ├── utils/
│   │   ├── apiHelpers.js        # ApiError, ApiResponse, asyncHandler
│   │   ├── jwt.js               # Token generation + verification
│   │   └── logger.js            # Winston logger
│   ├── app.js                   # Express app
│   └── server.js                # Entry point
├── logs/                        # Auto-created by Winston
├── .env.example
├── API_DOCUMENTATION.md
└── package.json
```

## Quick Start

```bash
# 1. Clone and install
cd olx-backend
npm install

# 2. Configure environment
cp .env.example .env
# Fill in all values in .env

# 3. Start development server
npm run dev

# 4. Production
npm start
```

## Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable | Description |
|---|---|
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Min 32-char secret for access tokens |
| `FIREBASE_*` | Firebase Admin SDK credentials |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `SMTP_*` | SMTP server credentials |
| `CLOUDINARY_*` | Cloudinary account credentials |
| `RAZORPAY_*` | Razorpay API keys |

## Security Checklist
- [x] Passwords hashed with bcrypt (12 rounds)
- [x] Refresh tokens stored as SHA-256 hash
- [x] JWT with issuer/audience validation
- [x] Helmet security headers
- [x] CORS whitelist
- [x] Rate limiting on all routes (strict on auth)
- [x] Input validation with Joi (strips unknown fields)
- [x] Razorpay webhook HMAC verification
- [x] Firebase token server-side verification
- [x] Password field excluded from all queries by default
- [x] Mongoose validation on all schemas
- [x] Global error handler (no stack traces in production)