/**
 * Kenya Re Nairobi Flood CatNet — API gateway + static intake UI
 */
require("dotenv").config();
const express = require("express");
const path = require("node:path");
const multer = require("multer");

const { processBrokerSlip } = require("./src/intake/orchestrator");
const { geocodeAddress } = require("./src/services/geocoder");
const { validateNairobiCoordinates } = require("./src/services/bounds");
const { loadDocument } = require("./src/loaders/document.loader");
const extractionRoutes = require("./src/routes/extraction.routes");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const frontendDir = path.join(__dirname, "..", "frontend", "public");
const maxBytes = Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes } });

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

async function parseSlipHandler(req, res) {
  try {
    let text = req.body && typeof req.body.text === "string" ? req.body.text : "";
    if (req.file) {
      text = await loadDocument(req.file);
    }
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'Field "text" or file is required.' });
    }
    const overrides = parseOverrides(req.body && req.body.overrides);
    const canonical = await processBrokerSlip(text, { overrides });
    return res.json(canonical);
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
