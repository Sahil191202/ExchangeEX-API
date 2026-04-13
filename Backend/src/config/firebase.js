const admin = require('firebase-admin');
const logger = require('../utils/logger');

let firebaseApp;

/**
 * Initialize Firebase Admin SDK (singleton).
 * Called once at server startup.
 */
const initializeFirebase = () => {
  if (firebaseApp) return firebaseApp;

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,
        // Handle escaped newlines in env variables
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        clientId: process.env.FIREBASE_CLIENT_ID,
        authUri: process.env.FIREBASE_AUTH_URI,
        tokenUri: process.env.FIREBASE_TOKEN_URI,
      }),
    });

    logger.info('Firebase Admin SDK initialized');
    return firebaseApp;
  } catch (error) {
    logger.error(`Firebase initialization failed: ${error.message}`);
    throw error;
  }
};

/**
 * Verify a Firebase ID token (used for OTP-based phone login).
 * @param {string} idToken - Firebase ID token from client
 * @returns {Promise<admin.auth.DecodedIdToken>}
 */
const verifyFirebaseToken = async (idToken) => {
  if (!firebaseApp) initializeFirebase();
  return admin.auth().verifyIdToken(idToken);
};

module.exports = { initializeFirebase, verifyFirebaseToken };