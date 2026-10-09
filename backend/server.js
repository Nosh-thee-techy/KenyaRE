/**
 * Kenya Re Nairobi Flood CatNet — API gateway + static intake UI
 */
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const express = require("express");
const fs = require("node:fs");
const multer = require("multer");

const { processBrokerSlip } = require("./src/intake/orchestrator");
const { geocodeAddress } = require("./src/services/geocoder");
const { validateNairobiCoordinates } = require("./src/services/bounds");
const { loadDocument, supportedExtensions } = require("./src/loaders/document.loader");
const extractionRoutes = require("./src/routes/extraction.routes");
const {
  saveExposure,
  saveModelRun,
  getExposure,
  getModelRun,
  getSession,
  listExposures,
  deleteExposure,
  asPlainId,
  sanitizeDocId
} = require("./src/services/firestore.service");
const { getFirebaseWebConfig, hasFirebaseWebConfig } = require("./src/services/firebase.config");
const { runCatModel, sampleSusceptibility } = require("./src/engine/catModel");
const { chatWithCopilot } = require("./src/services/copilot.service");
const { classifyHotspots, gatePin } = require("./src/engine/hotspots");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const frontendDir = path.join(__dirname, "..", "frontend", "public");
const maxBytes = Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxBytes },
  fileFilter: (_req, file, callback) => {
    if (!supportedExtensions.has(path.extname(file.originalname || "").toLowerCase())) {
      return callback(new Error("Unsupported file format."));
    }
    return callback(null, true);
  }
});

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(frontendDir));

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/health", (_req, res) =>
  res.json({
    status: "ok",
    peril: "Nairobi Urban Pluvial Flood",
    model: "Kenya Re CatNet v1.0",
    timestamp: new Date().toISOString()
  })
);

app.use("/api", extractionRoutes);

function parseOverrides(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return {};
  }
}

function isPlaceholderSlip(text) {
  return /^\(file\)\s+.+\s+[—\-].*upload/i.test(String(text || "").trim());
}

async function parseSlipHandler(req, res) {
  try {
    const bodyText = req.body && typeof req.body.text === "string" ? req.body.text : "";
    let text = isPlaceholderSlip(bodyText) ? "" : bodyText;
    let images = [];
    if (req.file) {
      const loaded = await loadDocument(req.file);
      const fileText = loaded && typeof loaded === "object" ? loaded.text || "" : String(loaded || "");
      images = loaded && loaded.images ? loaded.images : [];
      if (fileText && fileText.trim()) text = fileText;
    }
    if ((!text || !String(text).trim()) && !images.length) {
      return res.status(400).json({ error: 'Field "text" or file is required.' });
    }
    const overrides = parseOverrides(req.body && req.body.overrides);
    const canonical = await processBrokerSlip(text || "", { overrides, images });

    const sessionId =
      sanitizeDocId(canonical.id || asPlainId(canonical.reference)) ||
      sanitizeDocId("PROP-" + Date.now());
    canonical.id = sessionId;

    // Do not wait on Firestore — the underwriter should see the digest immediately.
    saveExposure(canonical)
      .then(function (savedDoc) {
        if (savedDoc && savedDoc.id) canonical.id = savedDoc.id;
      })
      .catch(function (saveErr) {
        console.warn("[Firestore] Auto-save on parse slip notice:", saveErr.message);
      });

    return res.json({ ...canonical, id: sessionId, extracted_text: text || "" });
  } catch (err) {
    console.error("Error parsing slip:", err);
    return res.status(500).json({
      error: "Internal server error processing broker slip.",
      details: err.message
    });
  }
}

app.post("/api/intake/parse-slip", upload.single("file"), parseSlipHandler);

app.post("/api/intake/geocode", async (req, res) => {
  try {
    const address = req.body && req.body.address;
    if (!address) return res.status(400).json({ error: 'Field "address" is required.' });
    return res.json(await geocodeAddress(address));
  } catch (err) {
    return res.status(500).json({ error: "Geocoding failed.", details: err.message });
  }
});

app.get("/api/intake/geocode", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Query "q" is required.' });
    const result = await geocodeAddress(String(q));
    if (!result.success) return res.status(502).json(result);
    return res.json(
      result.candidates.map((c) => ({
        label: c.display_name,
        lat: c.lat,
        lon: c.lon
      }))
    );
  } catch (err) {
    return res.status(500).json({ error: "Geocoding failed.", details: err.message });
  }
});

app.post("/api/intake/validate-coords", (req, res) => {
  const { lat, lon } = req.body || {};
  if (lat == null || lon == null) {
    return res.status(400).json({ error: 'Fields "lat" and "lon" are required.' });
  }
  return res.json(validateNairobiCoordinates(parseFloat(lat), parseFloat(lon)));
});

app.get("/api/intake/demo/landmark", async (_req, res) => {
  try {
    const slipPath = path.join(__dirname, "data/sample_placement_slip.txt");
    if (!fs.existsSync(slipPath)) {
      return res.status(404).json({ error: "Sample slip not found on server." });
    }
    const slipText = fs.readFileSync(slipPath, "utf-8");
    const canonical = await processBrokerSlip(slipText);
    return res.json({
      raw_text: slipText,
      canonical
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load demo fixture.", details: err.message });
  }
});

app.get("/api/firebase-config", (_req, res) => {
  if (!hasFirebaseWebConfig()) {
    return res.status(503).json({ error: "Firebase web config is not configured." });
  }
  return res.json(getFirebaseWebConfig());
});

// -------------------------------------------------------------
// FIRESTORE DATABASE PERSISTENCE ENDPOINTS
// -------------------------------------------------------------
app.post("/api/exposure/save", async (req, res) => {
  try {
    const record = req.body;
    if (!record || typeof record !== "object" || (!record.property_name && !record.reference)) {
      return res.status(400).json({
        error: "A valid Canonical Exposure Record object is required in the request body."
      });
    }

    const result = await saveExposure(record);
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error saving exposure to Firestore:", err);
    return res.status(500).json({
      error: "Failed to persist exposure record to Firestore.",
      details: err.message
    });
  }
});

app.get("/api/exposure", async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const records = await listExposures(limit);
    return res.json(records);
  } catch (err) {
    return res.status(500).json({
      error: "Failed to list exposure records from Firestore.",
      details: err.message
    });
  }
});

app.get("/api/hotspots", async (req, res) => {
  try {
    const book = await classifyHotspots(sampleSusceptibility);
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const gate = await gatePin(lat, lon, sampleSusceptibility);
      return res.json({ ...book, gate });
    }
    return res.json(book);
  } catch (err) {
    return res.status(500).json({ error: "Hotspot classification failed.", details: err.message });
  }
});

app.get("/api/session/:id", async (req, res) => {
  try {
    const session = await getSession(req.params.id);
    if (!session.input && !session.output) {
      return res.status(404).json({ error: `Session '${req.params.id}' was not found.` });
    }
    return res.json(session);
  } catch (err) {
    return res.status(500).json({
      error: "Failed to retrieve session.",
      details: err.message
    });
  }
});

app.get("/api/model/:id", async (req, res) => {
  try {
    const record = await getModelRun(req.params.id);
    if (!record) {
      return res.status(404).json({
        error: `Model output for '${req.params.id}' was not found.`
      });
    }
    return res.json(record);
  } catch (err) {
    return res.status(500).json({
      error: "Failed to retrieve model output.",
      details: err.message
    });
  }
});

app.get("/api/exposure/:id", async (req, res) => {
  try {
    const record = await getExposure(req.params.id);
    if (!record) {
      return res.status(404).json({
        error: `Exposure record with reference or ID '${req.params.id}' was not found.`
      });
    }
    return res.json(record);
  } catch (err) {
    return res.status(500).json({
      error: "Failed to retrieve exposure record.",
      details: err.message
    });
  }
});

app.delete("/api/exposure/:id", async (req, res) => {
  try {
    const success = await deleteExposure(req.params.id);
    return res.json({ success, id: req.params.id });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to delete exposure record.",
      details: err.message
    });
  }
});

// -------------------------------------------------------------
// CATASTROPHE ENGINE EXECUTION ENDPOINT
// Evaluates hazard, vulnerability, and financial losses; saves to Firestore
// -------------------------------------------------------------
app.post("/api/model/run", async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Exposure risk data payload is required." });
    }

    const sessionId = sanitizeDocId(body.id || asPlainId(body.reference));
    let exposureData = body;
    if (sessionId) {
      const storedInput = await getExposure(sessionId);
      if (storedInput && (!body.coordinates && !body.exposure)) {
        exposureData = storedInput;
      }
    }

    const inputSave = await saveExposure({ ...exposureData, id: sessionId || undefined });
    const id = inputSave.id;

    const results = await runCatModel(exposureData);
    const outputSave = await saveModelRun(id, results);

    if (results && results.success === false) {
      return res.status(422).json({
        success: false,
        id: id,
        input: inputSave.data,
        output: outputSave.data,
        results: results
      });
    }

    return res.json({
      success: true,
      id: id,
      storage: outputSave.storage,
      input: inputSave.data,
      output: outputSave.data,
      exposure: inputSave.data,
      results: results
    });
  } catch (err) {
    console.error("Error executing catastrophe model:", err);
    return res.status(500).json({
      error: "Catastrophe model execution failed.",
    });
  }
});

// -------------------------------------------------------------
// STEP 5: AI UNDERWRITING COPILOT & WHAT-IF INTELLIGENCE ENDPOINT
// Answers technical/non-technical questions and executes live what-if simulations
// -------------------------------------------------------------
app.post("/api/copilot/chat", async (req, res) => {
  try {
    const { query, exposure, results, history } = req.body || {};
    if (!query || !String(query).trim()) {
      return res.status(400).json({ error: "Field 'query' is required." });
    }

    const copilotResponse = await chatWithCopilot({
      query: String(query).trim(),
      exposure: exposure || {},
      results: results || null,
      history: history || []
    });

    return res.json({
      success: true,
      ...copilotResponse
    });
  } catch (err) {
    console.error("Error in Copilot chat:", err);
    return res.status(500).json({
      error: "Copilot chat failed.",
      details: err.message
    });
  }
});

app.use((error, _req, res, _next) => {
  if (error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Uploaded file exceeds the size limit." });
  }
  if (error.message === "Unsupported file format.") {
    return res.status(415).json({ error: error.message });
  }
  return res.status(400).json({ error: error.message || "Invalid request." });
});

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Kenya Re CatNet on http://localhost:${PORT}`);
    console.log(`Intake UI:  http://localhost:${PORT}/`);
    console.log(`Health:     http://localhost:${PORT}/health`);
  });
}

module.exports = app;
