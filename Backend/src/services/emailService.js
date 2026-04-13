const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

let transporter;

/**
 * Initialize Nodemailer transporter (singleton).
 * Uses SMTP settings from environment variables.
 */
const getTransporter = () => {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Pool connections for better performance in production
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });

  return transporter;
};

/**
 * Core send function — wraps nodemailer with error handling and logging.
 * All other methods in this module call this.
 *
 * @param {object} options - nodemailer mail options
 */
const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const info = await getTransporter().sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ''), // strip HTML for plaintext fallback
    });

    logger.info(`Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (error) {
    // Log but don't throw — email failure shouldn't break the API response
    logger.error(`Failed to send email to ${to}: ${error.message}`);
  }
};

// ─── HTML Email Templates ──────────────────────────────────────────────────────

const baseTemplate = (content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
    .wrapper { max-width: 600px; margin: 30px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: #002f34; padding: 24px 32px; }
    .header h1 { color: #23e5db; margin: 0; font-size: 24px; }
    .body { padding: 32px; color: #333; line-height: 1.6; }
    .body h2 { color: #002f34; margin-top: 0; }
    .btn { display: inline-block; margin: 20px 0; padding: 12px 28px; background: #002f34; color: #fff !important; text-decoration: none; border-radius: 6px; font-weight: bold; }
    .highlight { background: #f0f9f9; border-left: 4px solid #23e5db; padding: 12px 16px; margin: 16px 0; border-radius: 0 4px 4px 0; }
    .footer { background: #f8f8f8; padding: 16px 32px; font-size: 12px; color: #888; text-align: center; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header"><h1>OLX Platform</h1></div>
    <div class="body">${content}</div>
    <div class="footer">© ${new Date().getFullYear()} OLX Platform. All rights reserved.</div>
  </div>
</body>
</html>
`;

// ─── Notification Methods ──────────────────────────────────────────────────────

/**
 * Send welcome + email verification email.
 */
const sendVerificationEmail = async (user, verificationToken) => {
  const verificationUrl = `${process.env.CLIENT_URL}/api/auth/verify-email?token=${verificationToken}`;

  await sendEmail({
    to: user.email,
    subject: 'Verify your email — OLX Platform',
    html: baseTemplate(`
      <h2>Welcome, ${user.username}! 🎉</h2>
      <p>Thanks for joining OLX Platform. Please verify your email address to get started.</p>
      <a href="${verificationUrl}" class="btn">Verify My Email</a>
      <p>This link expires in <strong>24 hours</strong>.</p>
      <p>If you didn't create an account, please ignore this email.</p>
    `),
  });
};

/**
 * Send password reset email.
 */
const sendPasswordResetEmail = async (user, resetToken) => {
  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;

  await sendEmail({
    to: user.email,
    subject: 'Password Reset Request — OLX Platform',
    html: baseTemplate(`
      <h2>Reset Your Password</h2>
      <p>You requested a password reset for your OLX Platform account.</p>
      <a href="${resetUrl}" class="btn">Reset Password</a>
      <p>This link expires in <strong>1 hour</strong>. If you didn't request this, please ignore this email.</p>
    `),
  });
};

/**
 * Notify user that their listing was submitted for review.
 */
const sendListingSubmittedEmail = async (user, listing) => {
  await sendEmail({
    to: user.email,
    subject: `Your listing is under review — "${listing.title}"`,
    html: baseTemplate(`
      <h2>Listing Submitted for Review</h2>
      <div class="highlight">
        <strong>${listing.title}</strong><br>
        Category: ${listing.category} | Price: ₹${listing.price.toLocaleString()}
      </div>
      <p>Our team is reviewing your listing. You'll receive an email once it's approved (usually within 24 hours).</p>
    `),
  });
};

/**
 * Notify user that their listing was approved.
 */
const sendListingApprovedEmail = async (user, listing) => {
  const listingUrl = `${process.env.CLIENT_URL}/listings/${listing._id}`;

  await sendEmail({
    to: user.email,
    subject: `✅ Your listing is live! — "${listing.title}"`,
    html: baseTemplate(`
      <h2>Your Listing is Approved!</h2>
      <div class="highlight">
        <strong>${listing.title}</strong><br>
        Category: ${listing.category} | Price: ₹${listing.price.toLocaleString()}
      </div>
      <p>Great news! Your listing has been approved and is now visible to buyers.</p>
      <a href="${listingUrl}" class="btn">View Your Listing</a>
    `),
  });
};

/**
 * Notify user that their listing was rejected.
 */
const sendListingRejectedEmail = async (user, listing) => {
  await sendEmail({
    to: user.email,
    subject: `❌ Listing not approved — "${listing.title}"`,
    html: baseTemplate(`
      <h2>Listing Not Approved</h2>
      <div class="highlight">
        <strong>${listing.title}</strong><br>
        Reason: ${listing.rejectionReason || 'Did not meet our listing guidelines'}
      </div>
      <p>Unfortunately your listing couldn't be approved at this time. Please review our guidelines and resubmit.</p>
      <a href="${process.env.CLIENT_URL}/listings/new" class="btn">Create New Listing</a>
    `),
  });
};

/**
 * Confirm a subscription purchase.
 */
const sendSubscriptionConfirmationEmail = async (user, subscription, transaction) => {
  const planLabel = subscription.plan === 'bundle' ? '10 Listings Bundle' : 'Single Listing';

  await sendEmail({
    to: user.email,
    subject: `Payment confirmed — ${planLabel} subscription`,
    html: baseTemplate(`
      <h2>Payment Successful! 🎉</h2>
      <div class="highlight">
        <strong>Plan:</strong> ${planLabel}<br>
        <strong>Amount Paid:</strong> ₹${transaction.amount}<br>
        <strong>Credits:</strong> ${subscription.totalCredits} listing(s)<br>
        <strong>Valid Until:</strong> ${new Date(subscription.expiresAt).toLocaleDateString('en-IN')}
      </div>
      <p>You can now post ads using your subscription credits.</p>
      <a href="${process.env.CLIENT_URL}/listings/new" class="btn">Post an Ad</a>
    `),
  });
};

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendListingSubmittedEmail,
  sendListingApprovedEmail,
  sendListingRejectedEmail,
  sendSubscriptionConfirmationEmail,
};