/**
 * Kenya Re CatNet - Frontend Firebase & Firestore Integration
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

let db = null;
let app = null;

/**
 * Initializes the Firebase app and Firestore instance in the browser.
 */
function initFirebase() {
  if (db) return db;

  if (typeof window !== "undefined" && window.firebase && window.firebase.firestore) {
    if (!window.firebase.apps || window.firebase.apps.length === 0) {
      app = window.firebase.initializeApp(FIREBASE_CONFIG);
    } else {
      app = window.firebase.apps[0];
    }
    db = window.firebase.firestore();
    console.log("✅ [Firebase] Initialized live Firestore client for project:", FIREBASE_CONFIG.projectId);
    return db;
  }
  return null;
}

/**
 * Saves a Canonical Exposure record into Cloud Firestore collection 'exposures'
 * @param {Object} canonicalRecord
 * @returns {Promise<Object>}
 */
async function saveExposureToFirestore(canonicalRecord) {
  if (!canonicalRecord || !canonicalRecord.property_name) {
    throw new Error("Invalid canonical exposure record.");
  }

  const ref = (canonicalRecord.reference && (canonicalRecord.reference.value || canonicalRecord.reference)) || `PROP-${Date.now()}`;
  const docId = String(ref).replace(/[\/\s#?\[\]]/g, "-").trim();
  const firestoreInstance = initFirebase();

  const payload = {
    ...canonicalRecord,
    id: docId,
    schema_version: "1.0",
    peril: "Nairobi Urban Pluvial Flood",
    updated_at: new Date().toISOString()
  };

  // Method 1: Direct Cloud Firestore SDK write
  if (firestoreInstance) {
    try {
      const docRef = firestoreInstance.collection("exposures").doc(docId);
      await docRef.set(payload, { merge: true });
      console.log(`✅ [Firestore] Direct write to 'exposures/${docId}' successful.`);
      return { success: true, id: docId, mode: "client_firestore", data: payload };
    } catch (clientErr) {
      console.warn("Direct Firestore SDK write failed, falling back to backend relay:", clientErr.message);
    }
  }

  // Method 2: Relay through Backend API (/api/exposure/save)
  const apiBase = typeof location !== "undefined" && location.port === "5173" ? "http://127.0.0.1:3000" : "";
  const response = await fetch(apiBase + "/api/exposure/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || `HTTP ${response.status} saving exposure record.`);
  }

  return await response.json();
}

/**
 * Fetches an exposure record by its reference/ID from Firestore
 * @param {string} idOrReference
 * @returns {Promise<Object>}
 */
async function getExposureFromFirestore(idOrReference) {
  const docId = String(idOrReference).replace(/[\/\s#?\[\]]/g, "-").trim();
  const firestoreInstance = initFirebase();

  if (firestoreInstance) {
    try {
      const snap = await firestoreInstance.collection("exposures").doc(docId).get();
      if (snap.exists) return snap.data();
    } catch (e) {
      console.warn("[Firestore] Client fetch failed, falling back to backend API:", e.message);
    }
  }

  const apiBase = typeof location !== "undefined" && location.port === "5173" ? "http://127.0.0.1:3000" : "";
  const response = await fetch(`${apiBase}/api/exposure/${encodeURIComponent(docId)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch exposure record: HTTP ${response.status}`);
  }
  return await response.json();
}

/**
 * Lists all stored exposure records from Firestore
 * @returns {Promise<Array<Object>>}
 */
async function listExposuresFromFirestore() {
  const firestoreInstance = initFirebase();

  if (firestoreInstance) {
    try {
      const snap = await firestoreInstance.collection("exposures").orderBy("updated_at", "desc").get();
      return snap.docs.map(doc => doc.data());
    } catch (e) {
      console.warn("[Firestore] Client list failed, falling back to backend API:", e.message);
    }
  }

  const apiBase = typeof location !== "undefined" && location.port === "5173" ? "http://127.0.0.1:3000" : "";
  const response = await fetch(`${apiBase}/api/exposure`);
  if (!response.ok) {
    throw new Error(`Failed to list exposures: HTTP ${response.status}`);
  }
  return await response.json();
}

// Global browser window attachment
if (typeof window !== "undefined") {
  window.FIREBASE_CONFIG = FIREBASE_CONFIG;
  window.CatNetFirebase = {
    FIREBASE_CONFIG,
    initFirebase,
    saveExposureToFirestore,
    getExposureFromFirestore,
    listExposuresFromFirestore
  };
}

// Node export
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FIREBASE_CONFIG,
    initFirebase,
    saveExposureToFirestore,
    getExposureFromFirestore,
    listExposuresFromFirestore
  };
}
