/**
 * Kenya Re Flood CatNet - Firebase Cloud Firestore Service
 * Handles persistence and retrieval of Canonical Exposure Records.
 */

const fs = require('fs');
const path = require('path');

let admin = null;
let db = null;
let isInitialized = false;
let isMockMode = false;

// Local fallback store path when running without live GCP/Firebase credentials
const LOCAL_CACHE_PATH = path.join(__dirname, '..', '..', 'data', 'firestore_local_cache.json');

/**
 * Initializes Firebase Admin SDK with Firestore.
 * Supports:
 *  1. FIREBASE_SERVICE_ACCOUNT_KEY (path to json file OR JSON string)
 *  2. GOOGLE_APPLICATION_CREDENTIALS (standard GCP env var)
 *  3. FIREBASE_PROJECT_ID (project ID with default creds)
 *  4. Graceful Local Fallback if no credentials are provided yet
 */
let adminApp = null;
let adminFirestore = null;

function initializeFirestore() {
  if (isInitialized) return { db, isMockMode };

  try {
    adminApp = require('firebase-admin/app');
    adminFirestore = require('firebase-admin/firestore');
  } catch (err) {
    console.warn('[Firestore] firebase-admin package not found. Running in local fallback mode.');
    isMockMode = true;
    isInitialized = true;
    return { db: null, isMockMode: true };
  }

  const existingApps = adminApp.getApps();
  if (existingApps.length > 0) {
    db = adminFirestore.getFirestore();
    isInitialized = true;
    isMockMode = false;
    return { db, isMockMode: false };
  }

  let credential = null;
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const gcpCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.FIREBASE_PROJECT_ID || 'ke4rein';

  try {
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
      console.log('✅ [Firestore] Connected to Google Cloud Firestore successfully (Project:', projectId, ').');
      isInitialized = true;
      isMockMode = false;
      return { db, isMockMode: false };
    }
  } catch (initErr) {
    console.warn(`⚠️ [Firestore] Cloud initialization warning: ${initErr.message}. Defaulting to local cache mode.`);
  }

  // If no Service Account key supplied, use local storage fallback so backend never crashes
  console.log(`ℹ️ [Firestore] Project '${projectId}' configured. Using local persistence fallback (data/firestore_local_cache.json).`);
  isMockMode = true;
  isInitialized = true;
  return { db: null, isMockMode: true };
}

// -------------------------------------------------------------
// LOCAL CACHE HELPERS (Fallback)
// -------------------------------------------------------------
let memoryCache = null;

function loadLocalCache() {
  if (memoryCache && Object.keys(memoryCache).length > 0) return memoryCache;
  try {
    if (fs.existsSync(LOCAL_CACHE_PATH)) {
      const data = fs.readFileSync(LOCAL_CACHE_PATH, 'utf-8');
      if (data && data.trim()) {
        memoryCache = JSON.parse(data);
        return memoryCache;
      }
    }
  } catch (e) {
    // Fall back to empty or existing memory cache
  }
  memoryCache = memoryCache || {};
  return memoryCache;
}

function saveLocalCache(cache) {
  memoryCache = cache;
  try {
    const dir = path.dirname(LOCAL_CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LOCAL_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Firestore Local Cache] Write error:', e.message);
  }
}

// -------------------------------------------------------------
// FIRESTORE CRUD OPERATIONS
// -------------------------------------------------------------

/**
 * Sanitizes an ID string for Firestore document key usage
 */
function sanitizeDocId(id) {
  return String(id || '').replace(/[\/\s#?\[\]]/g, '-').trim();
}

/**
 * Stores a Canonical Exposure Record into Cloud Firestore collection 'exposures'
 * @param {Object} canonicalRecord - The canonical schema record
 * @returns {Promise<Object>} Persisted document result
 */
async function saveExposure(canonicalRecord) {
  if (!canonicalRecord || typeof canonicalRecord !== 'object') {
    throw new Error('A valid Canonical Exposure Record object is required.');
  }

  const { db: firestoreDb, isMockMode: mock } = initializeFirestore();

  const ref = canonicalRecord.reference || `PROP-${Date.now()}`;
  const docId = sanitizeDocId(ref);

  const documentData = {
    ...canonicalRecord,
    id: docId,
    schema_version: '1.0',
    peril: 'Nairobi Urban Pluvial Flood',
    updated_at: new Date().toISOString()
  };

  if (!mock && firestoreDb) {
    try {
      const docRef = firestoreDb.collection('exposures').doc(docId);
      const existing = await docRef.get();
      if (!existing.exists) {
        documentData.created_at = new Date().toISOString();
      } else {
        documentData.created_at = existing.data().created_at || new Date().toISOString();
      }

      await docRef.set(documentData, { merge: true });
      return {
        success: true,
        id: docId,
        storage: 'cloud_firestore',
        collection: 'exposures',
        data: documentData
      };
    } catch (err) {
      console.warn('[Firestore] Cloud admin write notice:', err.message, '— Persisting to local project cache.');
    }
  }

  // Fallback to local cache
  const cache = loadLocalCache();
  const existing = cache[docId];
  documentData.created_at = existing ? existing.created_at : new Date().toISOString();
  cache[docId] = documentData;
  saveLocalCache(cache);

  return {
    success: true,
    id: docId,
    storage: 'local_cache_fallback',
    collection: 'exposures',
    data: documentData
  };
}

/**
 * Retrieves a Canonical Exposure Record by reference or ID
 * @param {string} idOrReference
 * @returns {Promise<Object|null>}
 */
async function getExposure(idOrReference) {
  const { db: firestoreDb, isMockMode: mock } = initializeFirestore();
  const docId = sanitizeDocId(idOrReference);

  if (!mock && firestoreDb) {
    try {
      const docRef = firestoreDb.collection('exposures').doc(docId);
      const snap = await docRef.get();
      if (snap.exists) {
        return snap.data();
      }
      const querySnap = await firestoreDb.collection('exposures').where('reference', '==', idOrReference).limit(1).get();
      if (!querySnap.empty) {
        return querySnap.docs[0].data();
      }
    } catch (err) {
      console.warn('[Firestore] Cloud admin read notice:', err.message, '— Reading from local cache.');
    }
  }

  const cache = loadLocalCache();
  if (cache[docId]) return cache[docId];
  const byRef = Object.values(cache).find(item => item.reference === idOrReference);
  return byRef || null;
}

/**
 * Lists all stored Canonical Exposure Records
 * @param {number} [limit=50]
 * @returns {Promise<Array<Object>>}
 */
async function listExposures(limit = 50) {
  const { db: firestoreDb, isMockMode: mock } = initializeFirestore();

  if (!mock && firestoreDb) {
    try {
      const snap = await firestoreDb.collection('exposures').orderBy('updated_at', 'desc').limit(limit).get();
      return snap.docs.map(doc => doc.data());
    } catch (err) {
      console.warn('[Firestore] Cloud admin list notice:', err.message, '— Reading from local cache.');
    }
  }

  const cache = loadLocalCache();
  return Object.values(cache)
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
    .slice(0, limit);
}

/**
 * Deletes an exposure record by ID or reference
 * @param {string} idOrReference
 * @returns {Promise<boolean>}
 */
async function deleteExposure(idOrReference) {
  const { db: firestoreDb, isMockMode: mock } = initializeFirestore();
  const docId = sanitizeDocId(idOrReference);

  if (!mock && firestoreDb) {
    await firestoreDb.collection('exposures').doc(docId).delete();
    return true;
  }

  const cache = loadLocalCache();
  if (cache[docId]) {
    delete cache[docId];
    saveLocalCache(cache);
    return true;
  }
  return false;
}

module.exports = {
  initializeFirestore,
  saveExposure,
  getExposure,
  listExposures,
  deleteExposure
};
