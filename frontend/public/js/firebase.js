/**
 * Kenya Re CatNet - Firebase Firestore (public static frontend)
 * Config is loaded from GET /api/firebase-config — never hardcode apiKey here.
 */

const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
  measurementId: ""
};

let firestoreDb = null;
let configPromise = null;

function apiBase() {
  return location.port === "5173" ? "http://127.0.0.1:3000" : "";
}

function applyConfig(cfg) {
  FIREBASE_CONFIG.apiKey = cfg.apiKey || "";
  FIREBASE_CONFIG.authDomain = cfg.authDomain || "";
  FIREBASE_CONFIG.projectId = cfg.projectId || "";
  FIREBASE_CONFIG.storageBucket = cfg.storageBucket || "";
  FIREBASE_CONFIG.messagingSenderId = cfg.messagingSenderId || "";
  FIREBASE_CONFIG.appId = cfg.appId || "";
  FIREBASE_CONFIG.measurementId = cfg.measurementId || "";
  return FIREBASE_CONFIG;
}

async function loadFirebaseConfig() {
  if (FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId) return FIREBASE_CONFIG;
  if (configPromise) return configPromise;
  configPromise = fetch(apiBase() + "/api/firebase-config")
    .then(function (res) {
      if (!res.ok) throw new Error("Firebase config unavailable");
      return res.json();
    })
    .then(applyConfig)
    .catch(function (err) {
      configPromise = null;
      console.warn("[Firestore] Config load notice:", err.message);
      return FIREBASE_CONFIG;
    });
  return configPromise;
}

async function initFirestore() {
  if (firestoreDb) return firestoreDb;

  const cfg = await loadFirebaseConfig();
  if (!cfg.apiKey || !cfg.projectId) {
    console.log("[Firestore] Using backend API relay (/api/exposure/save).");
    return null;
  }

  if (window.firebase && window.firebase.firestore) {
    try {
      if (!window.firebase.apps || window.firebase.apps.length === 0) {
        window.firebase.initializeApp(cfg);
      }
      firestoreDb = window.firebase.firestore();
      console.log("[Firestore] Browser connected to project:", cfg.projectId);
      return firestoreDb;
    } catch (err) {
      console.warn("[Firestore] Client initialization notice:", err.message);
    }
  } else {
    console.log("[Firestore] Browser SDK unavailable. Using backend API relay.");
  }
  return null;
}

async function saveExposureToFirestore(canonicalRecord) {
  if (!canonicalRecord) {
    throw new Error("No risk data provided to save.");
  }

  const db = await initFirestore();
  const rawRef =
    (canonicalRecord.reference && (canonicalRecord.reference.value || canonicalRecord.reference)) ||
    `PROP-${Date.now()}`;
  const docId = String(rawRef).replace(/[\/\s#?\[\]]/g, "-").trim();

  const payload = {
    ...canonicalRecord,
    id: docId,
    schema_version: "1.0",
    peril: "Nairobi Urban Pluvial Flood",
    updated_at: new Date().toISOString()
  };

  if (db) {
    try {
      await db.collection("exposures").doc(docId).set(payload, { merge: true });
      console.log("[Firestore] Direct write succeeded for", docId);
      return { success: true, id: docId, method: "firestore_client_sdk", data: payload };
    } catch (clientErr) {
      console.warn("Direct Cloud Firestore write failed, falling back to backend relay:", clientErr.message);
    }
  }

  const response = await fetch(apiBase() + "/api/exposure/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(function () {
      return {};
    });
    throw new Error(errorBody.error || `HTTP ${response.status} saving exposure to database.`);
  }

  const result = await response.json();
  console.log("[Firestore] Backend relay save succeeded. Doc ID:", result.id);
  return result;
}

window.CatNetFirebase = {
  FIREBASE_CONFIG,
  loadFirebaseConfig,
  initFirestore,
  saveExposureToFirestore
};

document.addEventListener("DOMContentLoaded", function () {
  initFirestore();
});
