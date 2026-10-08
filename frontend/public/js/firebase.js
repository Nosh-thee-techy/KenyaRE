/**
 * Kenya Re CatNet - Firebase Firestore Integration (Public Frontend)
 * Connected to live Firebase project: ke4rein
 */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD_VPB1Q0Q6Bn1fO0WQyu4OrM4KnLntWhc",
  authDomain: "ke4rein.firebaseapp.com",
  projectId: "ke4rein",
  storageBucket: "ke4rein.firebasestorage.app",
  messagingSenderId: "563776490783",
  appId: "1:563776490783:web:8cdd7791bc0dbe532b742a",
  measurementId: "G-QFDFJW4ZTR"
};

let firestoreDb = null;

/**
 * Initializes Firestore in the browser using the Firebase Compat SDK
 */
function initFirestore() {
  if (firestoreDb) return firestoreDb;

  if (window.firebase && window.firebase.firestore) {
    try {
      if (!window.firebase.apps || window.firebase.apps.length === 0) {
        window.firebase.initializeApp(FIREBASE_CONFIG);
      }
      firestoreDb = window.firebase.firestore();
      console.log("✅ [Firestore] Browser connected to live Firebase project: ke4rein");
      return firestoreDb;
    } catch (err) {
      console.warn("⚠️ [Firestore] Client initialization notice:", err.message);
    }
  } else {
    console.log("ℹ️ [Firestore] Browser SDK loading. Using Backend API relay (/api/exposure/save).");
  }
  return null;
}

/**
 * Saves all canonical values from the intake/review form to Firestore database collection 'exposures'.
 * 
 * @param {Object} canonicalRecord - Full canonical exposure schema
 * @returns {Promise<Object>} Save result
 */
async function saveExposureToFirestore(canonicalRecord) {
  if (!canonicalRecord) {
    throw new Error("No risk data provided to save.");
  }

  const db = initFirestore();
  const ref = (canonicalRecord.reference && (canonicalRecord.reference.value || canonicalRecord.reference)) || `PROP-${Date.now()}`;
  const docId = String(ref).replace(/[\/\s#?\[\]]/g, "-").trim();

  const payload = {
    ...canonicalRecord,
    id: docId,
    schema_version: "1.0",
    peril: "Nairobi Urban Pluvial Flood",
    updated_at: new Date().toISOString()
  };

  // 1. Direct write to live Cloud Firestore if SDK initialized
  if (db) {
    try {
      const docRef = db.collection("exposures").doc(docId);
      await docRef.set(payload, { merge: true });
      console.log(`✅ [Firestore] Direct write to 'exposures/${docId}' successful.`);
      return { success: true, id: docId, method: "firestore_client_sdk", data: payload };
    } catch (clientErr) {
      console.warn("Direct Cloud Firestore write failed, falling back to backend relay:", clientErr.message);
    }
  }

  // 2. Relay write via Dev 3 Express API (/api/exposure/save)
  const apiBase = location.port === "5173" ? "http://127.0.0.1:3000" : "";
  const response = await fetch(apiBase + "/api/exposure/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || `HTTP ${response.status} saving exposure to database.`);
  }

  const result = await response.json();
  console.log(`✅ [Firestore] Backend relay save successful. Doc ID: ${result.id}`);
  return result;
}

// Attach globally
window.CatNetFirebase = {
  FIREBASE_CONFIG,
  initFirestore,
  saveExposureToFirestore
};

// Auto-initialize on page load
document.addEventListener("DOMContentLoaded", () => {
  initFirestore();
});
