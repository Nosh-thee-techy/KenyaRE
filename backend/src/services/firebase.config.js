/**
 * Firebase web client config from gitignored env.
 * Do not log apiKey or dump process.env.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env"), quiet: true });

function getFirebaseWebConfig() {
  return {
    apiKey: process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.FIREBASE_APP_ID || "",
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || ""
  };
}

function hasFirebaseWebConfig() {
  const cfg = getFirebaseWebConfig();
  return Boolean(cfg.apiKey && cfg.projectId);
}

module.exports = {
  getFirebaseWebConfig,
  hasFirebaseWebConfig
};
