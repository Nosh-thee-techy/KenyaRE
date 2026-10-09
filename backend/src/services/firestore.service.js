/**
 * Kenya Re Flood CatNet — Firestore persistence.
 *
 * Two documents, one session ID:
 *   exposures/{id}   → INPUT  (parsed slip / canonical exposure)
 *   model_runs/{id}  → OUTPUT (CAT engine JSON)
 *
 * Credential order:
 *  1. FIREBASE_SERVICE_ACCOUNT_KEY / GOOGLE_APPLICATION_CREDENTIALS (Admin SDK)
 *  2. Firebase web client config from env (client SDK — no Analytics in Node)
 *  3. Local JSON fallback so intake never crashes
 */

const fs = require("fs");
const path = require("path");
const { getFirebaseWebConfig, hasFirebaseWebConfig } = require("./firebase.config");

let db = null;
let clientDb = null;
let clientFs = null;
let isInitialized = false;
let storageMode = "local";

const LOCAL_CACHE_PATH = path.join(__dirname, "..", "..", "data", "firestore_local_cache.json");
const CLOUD_TIMEOUT_MS = 15000;
const INPUT_COLLECTION = "exposures";
const OUTPUT_COLLECTION = "model_runs";

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + " timed out")), CLOUD_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function asPlainId(value) {
  if (value == null || value === "") return "";
  if (typeof value === "object") {
    if (value.value != null && value.value !== "") return String(value.value);
    return "";
  }
  return String(value);
}

function sanitizeDocId(id) {
  return String(asPlainId(id) || id || "").replace(/[\/\s#?\[\]]/g, "-").trim();
}

function initializeFirestore() {
  if (isInitialized) {
    return { db, clientDb, storageMode, isMockMode: storageMode === "local" };
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || getFirebaseWebConfig().projectId || "ke4rein";

  try {
    const adminApp = require("firebase-admin/app");
    const adminFirestore = require("firebase-admin/firestore");
    const existingApps = adminApp.getApps();
    if (existingApps.length > 0) {
      db = adminFirestore.getFirestore();
      isInitialized = true;
      storageMode = "cloud_firestore";
      return { db, clientDb, storageMode, isMockMode: false };
    }

    let credential = null;
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    const gcpCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (serviceAccountKey) {
      if (fs.existsSync(serviceAccountKey)) {
        credential = adminApp.cert(require(path.resolve(serviceAccountKey)));
      } else {
        const parsed = JSON.parse(serviceAccountKey);
        credential = adminApp.cert(parsed);
      }
    } else if (gcpCreds && fs.existsSync(gcpCreds)) {
      credential = adminApp.applicationDefault();
    }

    if (credential) {
      adminApp.initializeApp({
        credential,
        projectId: projectId || undefined
      });
      db = adminFirestore.getFirestore();
      console.log("[Firestore] Connected with Admin SDK (Project:", projectId, ").");
      isInitialized = true;
      storageMode = "cloud_firestore";
      return { db, clientDb, storageMode, isMockMode: false };
    }
  } catch (initErr) {
    console.warn("[Firestore] Admin SDK unavailable:", initErr.message);
  }

  if (hasFirebaseWebConfig()) {
    try {
      const { initializeApp, getApps } = require("firebase/app");
      clientFs = require("firebase/firestore");
      const webConfig = getFirebaseWebConfig();
      const app = getApps().length ? getApps()[0] : initializeApp(webConfig);
      clientDb = clientFs.getFirestore(app);
      console.log(`[Firestore] Connected with web SDK (Project: ${webConfig.projectId}).`);
      isInitialized = true;
      storageMode = "firestore_web_sdk";
      return { db: null, clientDb, storageMode, isMockMode: false };
    } catch (webErr) {
      console.warn("[Firestore] Web SDK init notice:", webErr.message);
    }
  }

  console.log("[Firestore] Project", projectId, "configured. Using local persistence fallback.");
  isInitialized = true;
  storageMode = "local";
  return { db: null, clientDb: null, storageMode, isMockMode: true };
}

let memoryCache = null;

function emptyStore() {
  return { exposures: {}, model_runs: {} };
}

function normalizeStore(raw) {
  if (!raw || typeof raw !== "object") return emptyStore();
  if (raw.exposures || raw.model_runs) {
    return {
      exposures: raw.exposures && typeof raw.exposures === "object" ? raw.exposures : {},
      model_runs: raw.model_runs && typeof raw.model_runs === "object" ? raw.model_runs : {}
    };
  }
  const exposures = {};
  Object.keys(raw).forEach(function (key) {
    if (key === "exposures" || key === "model_runs") return;
    exposures[key] = raw[key];
  });
  return { exposures: exposures, model_runs: {} };
}

function loadLocalCache() {
  if (memoryCache) return normalizeStore(memoryCache);
  try {
    if (fs.existsSync(LOCAL_CACHE_PATH)) {
      const data = fs.readFileSync(LOCAL_CACHE_PATH, "utf-8");
      if (data && data.trim()) {
        memoryCache = JSON.parse(data);
        return normalizeStore(memoryCache);
      }
    }
  } catch (_e) {
    // Fall back to empty store
  }
  memoryCache = emptyStore();
  return normalizeStore(memoryCache);
}

function saveLocalCache(store) {
  const normalized = normalizeStore(store);
  memoryCache = normalized;
  try {
    const dir = path.dirname(LOCAL_CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LOCAL_CACHE_PATH, JSON.stringify(normalized, null, 2), "utf-8");
  } catch (e) {
    console.error("[Firestore Local Cache] Write error:", e.message);
  }
}

function localSave(collection, docId, documentData) {
  const store = loadLocalCache();
  const bucket = store[collection] || {};
  const existing = bucket[docId];
  documentData.created_at = existing ? existing.created_at : new Date().toISOString();
  bucket[docId] = documentData;
  store[collection] = bucket;
  saveLocalCache(store);
  return {
    success: true,
    id: docId,
    storage: "local_cache_fallback",
    collection: collection,
    data: documentData
  };
}

function localGet(collection, docId) {
  const store = loadLocalCache();
  const bucket = store[collection] || {};
  return bucket[docId] || null;
}

async function writeDoc(collection, docId, documentData) {
  const { db: firestoreDb, clientDb: webDb, storageMode: mode } = initializeFirestore();

  if (mode === "cloud_firestore" && firestoreDb) {
    try {
      const docRef = firestoreDb.collection(collection).doc(docId);
      const existing = await withTimeout(docRef.get(), "admin get");
      documentData.created_at = existing.exists
        ? existing.data().created_at || new Date().toISOString()
        : new Date().toISOString();
      await withTimeout(docRef.set(documentData, { merge: true }), "admin set");
      return {
        success: true,
        id: docId,
        storage: "cloud_firestore",
        collection: collection,
        data: documentData
      };
    } catch (err) {
      console.warn("[Firestore] Admin write notice:", err.message, "— persisting to local cache.");
    }
  }

  if (mode === "firestore_web_sdk" && webDb && clientFs) {
    try {
      const docRef = clientFs.doc(webDb, collection, docId);
      const existing = await withTimeout(clientFs.getDoc(docRef), "web get");
      documentData.created_at = existing.exists()
        ? existing.data().created_at || new Date().toISOString()
        : new Date().toISOString();
      await withTimeout(clientFs.setDoc(docRef, documentData, { merge: true }), "web set");
      return {
        success: true,
        id: docId,
        storage: "firestore_web_sdk",
        collection: collection,
        data: documentData
      };
    } catch (err) {
      console.warn("[Firestore] Web SDK write notice:", err.message, "— persisting to local cache.");
    }
  }

  return localSave(collection, docId, documentData);
}

async function readDoc(collection, idOrReference) {
  const { db: firestoreDb, clientDb: webDb, storageMode: mode } = initializeFirestore();
  const docId = sanitizeDocId(idOrReference);
  if (!docId) return null;

  if (mode === "cloud_firestore" && firestoreDb) {
    try {
      const snap = await withTimeout(firestoreDb.collection(collection).doc(docId).get(), "admin get");
      if (snap.exists) return snap.data();
    } catch (err) {
      console.warn("[Firestore] Admin read notice:", err.message, "— reading from local cache.");
    }
  }

  if (mode === "firestore_web_sdk" && webDb && clientFs) {
    try {
      const snap = await withTimeout(clientFs.getDoc(clientFs.doc(webDb, collection, docId)), "web get");
      if (snap.exists()) return snap.data();
    } catch (err) {
      console.warn("[Firestore] Web SDK read notice:", err.message, "— reading from local cache.");
    }
  }

  return localGet(collection, docId);
}

function sessionIdFrom(record) {
  if (!record || typeof record !== "object") return "";
  return sanitizeDocId(record.id || record.reference) || "";
}

async function saveExposure(canonicalRecord) {
  if (!canonicalRecord || typeof canonicalRecord !== "object") {
    throw new Error("A valid Canonical Exposure Record object is required.");
  }

  const docId = sessionIdFrom(canonicalRecord) || sanitizeDocId(`PROP-${Date.now()}`);
  const input = { ...canonicalRecord };
  delete input.model_results;
  delete input.results;
  delete input.ep_curve;
  delete input.metrics;

  const documentData = {
    ...input,
    id: docId,
    kind: "input",
    reference: asPlainId(canonicalRecord.reference) || canonicalRecord.reference || docId,
    property_name: asPlainId(canonicalRecord.property_name) || canonicalRecord.property_name || null,
    schema_version: "1.0",
    peril: "Nairobi Urban Pluvial Flood",
    updated_at: new Date().toISOString()
  };

  return writeDoc(INPUT_COLLECTION, docId, documentData);
}

async function saveModelRun(sessionId, results, meta) {
  const docId = sanitizeDocId(sessionId);
  if (!docId) throw new Error("A session ID is required to save model output.");
  const extra = meta && typeof meta === "object" ? meta : {};
  const documentData = {
    id: docId,
    kind: "output",
    input_id: docId,
    evaluated_at: (results && results.evaluated_at) || new Date().toISOString(),
    success: results && results.success !== false,
    results: results || {},
    updated_at: new Date().toISOString(),
    ...extra
  };
  return writeDoc(OUTPUT_COLLECTION, docId, documentData);
}

async function getExposure(idOrReference) {
  return readDoc(INPUT_COLLECTION, idOrReference);
}

async function getModelRun(idOrReference) {
  return readDoc(OUTPUT_COLLECTION, idOrReference);
}

async function getSession(idOrReference) {
  const id = sanitizeDocId(idOrReference);
  const input = await getExposure(id);
  const output = await getModelRun(id);
  return { id: id, input: input, output: output };
}

async function listExposures(limit) {
  const { db: firestoreDb, clientDb: webDb, storageMode: mode } = initializeFirestore();
  const cap = Number(limit) || 50;

  if (mode === "cloud_firestore" && firestoreDb) {
    try {
      const snap = await withTimeout(
        firestoreDb.collection(INPUT_COLLECTION).orderBy("updated_at", "desc").limit(cap).get(),
        "admin list"
      );
      return snap.docs.map(function (docSnap) {
        return docSnap.data();
      });
    } catch (err) {
      console.warn("[Firestore] Admin list notice:", err.message, "— reading from local cache.");
    }
  }

  if (mode === "firestore_web_sdk" && webDb && clientFs) {
    try {
      const q = clientFs.query(
        clientFs.collection(webDb, INPUT_COLLECTION),
        clientFs.orderBy("updated_at", "desc"),
        clientFs.limit(cap)
      );
      const snap = await withTimeout(clientFs.getDocs(q), "web list");
      return snap.docs.map(function (docSnap) {
        return docSnap.data();
      });
    } catch (err) {
      console.warn("[Firestore] Web SDK list notice:", err.message, "— reading from local cache.");
    }
  }

  const store = loadLocalCache();
  return Object.values(store.exposures || {})
    .sort(function (a, b) {
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    })
    .slice(0, cap);
}

async function deleteExposure(idOrReference) {
  const { db: firestoreDb, clientDb: webDb, storageMode: mode } = initializeFirestore();
  const docId = sanitizeDocId(idOrReference);

  if (mode === "cloud_firestore" && firestoreDb) {
    await withTimeout(firestoreDb.collection(INPUT_COLLECTION).doc(docId).delete(), "admin delete");
    await withTimeout(firestoreDb.collection(OUTPUT_COLLECTION).doc(docId).delete(), "admin delete output");
    return true;
  }

  if (mode === "firestore_web_sdk" && webDb && clientFs) {
    await withTimeout(clientFs.deleteDoc(clientFs.doc(webDb, INPUT_COLLECTION, docId)), "web delete");
    await withTimeout(clientFs.deleteDoc(clientFs.doc(webDb, OUTPUT_COLLECTION, docId)), "web delete output");
    return true;
  }

  const store = loadLocalCache();
  let removed = false;
  if (store.exposures && store.exposures[docId]) {
    delete store.exposures[docId];
    removed = true;
  }
  if (store.model_runs && store.model_runs[docId]) {
    delete store.model_runs[docId];
    removed = true;
  }
  if (removed) saveLocalCache(store);
  return removed;
}

module.exports = {
  initializeFirestore,
  asPlainId,
  sanitizeDocId,
  saveExposure,
  saveModelRun,
  getExposure,
  getModelRun,
  getSession,
  listExposures,
  deleteExposure,
  INPUT_COLLECTION,
  OUTPUT_COLLECTION
};
