/**
 * Kenya Re CatNet - Frontend Firebase helper
 * Browser: load config from GET /api/firebase-config.
 * Node: read FIREBASE_* from env. Never hardcode apiKey.
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

let db = null;
let app = null;
let configPromise = null;

function applyConfig(cfg) {
  if (!cfg) return FIREBASE_CONFIG;
  FIREBASE_CONFIG.apiKey = cfg.apiKey || "";
  FIREBASE_CONFIG.authDomain = cfg.authDomain || "";
  FIREBASE_CONFIG.projectId = cfg.projectId || "";
  FIREBASE_CONFIG.storageBucket = cfg.storageBucket || "";
  FIREBASE_CONFIG.messagingSenderId = cfg.messagingSenderId || "";
  FIREBASE_CONFIG.appId = cfg.appId || "";
  FIREBASE_CONFIG.measurementId = cfg.measurementId || "";
  return FIREBASE_CONFIG;
}

function envConfig() {
  if (typeof process === "undefined" || !process.env) return null;
  if (!process.env.FIREBASE_API_KEY || !process.env.FIREBASE_PROJECT_ID) return null;
  return {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.FIREBASE_APP_ID || "",
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || ""
  };
}

function apiBase() {
  if (typeof location === "undefined") return "";
  return location.port === "5173" ? "http://127.0.0.1:3000" : "";
}

async function loadFirebaseConfig() {
  const fromEnv = envConfig();
  if (fromEnv) return applyConfig(fromEnv);
  if (FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId) return FIREBASE_CONFIG;
  if (typeof fetch !== "function") return FIREBASE_CONFIG;
  if (configPromise) return configPromise;
  configPromise = fetch(apiBase() + "/api/firebase-config")
    .then(function (res) {
      if (!res.ok) throw new Error("Firebase config unavailable");
      return res.json();
    })
    .then(applyConfig)
    .catch(function (err) {
      configPromise = null;
      console.warn("[Firebase] Config load notice:", err.message);
      return FIREBASE_CONFIG;
    });
  return configPromise;
}

async function initFirebase() {
  if (db) return db;
  const cfg = await loadFirebaseConfig();
  if (!cfg.apiKey || !cfg.projectId) return null;

  if (typeof window !== "undefined" && window.firebase && window.firebase.firestore) {
    if (!window.firebase.apps || window.firebase.apps.length === 0) {
      app = window.firebase.initializeApp(cfg);
    } else {
      app = window.firebase.apps[0];
    }
    db = window.firebase.firestore();
    console.log("[Firebase] Initialized Firestore client for project:", cfg.projectId);
    return db;
  }
  return null;
}

async function saveExposureToFirestore(canonicalRecord) {
  if (!canonicalRecord || !canonicalRecord.property_name) {
    throw new Error("Invalid canonical exposure record.");
  }

  const ref =
    (canonicalRecord.reference && (canonicalRecord.reference.value || canonicalRecord.reference)) ||
    `PROP-${Date.now()}`;
  const docId = String(ref).replace(/[\/\s#?\[\]]/g, "-").trim();
  const firestoreInstance = await initFirebase();

  const payload = {
    ...canonicalRecord,
    id: docId,
    schema_version: "1.0",
    peril: "Nairobi Urban Pluvial Flood",
    updated_at: new Date().toISOString()
  };

  if (firestoreInstance) {
    try {
      await firestoreInstance.collection("exposures").doc(docId).set(payload, { merge: true });
      return { success: true, id: docId, mode: "client_firestore", data: payload };
    } catch (clientErr) {
      console.warn("Direct Firestore SDK write failed, falling back to backend relay:", clientErr.message);
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
    throw new Error(errorBody.error || `HTTP ${response.status} saving exposure record.`);
  }

  return await response.json();
}

async function getExposureFromFirestore(idOrReference) {
  const docId = String(idOrReference).replace(/[\/\s#?\[\]]/g, "-").trim();
  const firestoreInstance = await initFirebase();

  if (firestoreInstance) {
    try {
      const snap = await firestoreInstance.collection("exposures").doc(docId).get();
      if (snap.exists) return snap.data();
    } catch (e) {
      console.warn("[Firestore] Client fetch failed, falling back to backend API:", e.message);
    }
  }

  const response = await fetch(`${apiBase()}/api/exposure/${encodeURIComponent(docId)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch exposure record: HTTP ${response.status}`);
  }
  return await response.json();
}

async function listExposuresFromFirestore() {
  const firestoreInstance = await initFirebase();

  if (firestoreInstance) {
    try {
      const snap = await firestoreInstance.collection("exposures").orderBy("updated_at", "desc").get();
      return snap.docs.map(function (docSnap) {
        return docSnap.data();
      });
    } catch (e) {
      console.warn("[Firestore] Client list failed, falling back to backend API:", e.message);
    }
  }

  const response = await fetch(`${apiBase()}/api/exposure`);
  if (!response.ok) {
    throw new Error(`Failed to list exposures: HTTP ${response.status}`);
  }
  return await response.json();
}

if (typeof window !== "undefined") {
  window.FIREBASE_CONFIG = FIREBASE_CONFIG;
  window.CatNetFirebase = {
    FIREBASE_CONFIG,
    loadFirebaseConfig,
    initFirebase,
    saveExposureToFirestore,
    getExposureFromFirestore,
    listExposuresFromFirestore
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FIREBASE_CONFIG,
    loadFirebaseConfig,
    initFirebase,
    saveExposureToFirestore,
    getExposureFromFirestore,
    listExposuresFromFirestore
  };
}
