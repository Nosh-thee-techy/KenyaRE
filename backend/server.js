/**
 * Kenya Re Nairobi Flood CatNet - Main Server & API Gateway
 * Express.js backend serving the Input Layer and catastrophe modeling endpoints.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { processBrokerSlip } = require('./src/intake/orchestrator');
const { geocodeAddress } = require('./src/services/geocoder');
const { validateNairobiCoordinates } = require('./src/services/bounds');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve frontend static assets from public/ directory
app.use(express.static(path.join(__dirname, 'public')));

// -----------------------------------------------------------------
// HEALTH CHECK
// -----------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    peril: 'Nairobi Urban Pluvial Flood',
    model: 'Kenya Re CatNet v1.0',
    timestamp: new Date().toISOString()
  });
});

// -----------------------------------------------------------------
// INTAKE ENDPOINT 1: Parse Broker Slip
// Ingests raw slip text, runs RAG/regex extraction, and applies fallbacks
// -----------------------------------------------------------------
app.post('/api/intake/parse-slip', async (req, res) => {
  try {
    const { text, overrides } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Field "text" is required and must be a string.' });
    }

    const canonical = await processBrokerSlip(text, { overrides });
    return res.json(canonical);
  } catch (err) {
    console.error('Error parsing slip:', err);
    return res.status(500).json({ error: 'Internal server error processing broker slip.', details: err.message });
  }
});

// -----------------------------------------------------------------
// INTAKE ENDPOINT 2: Address Geocoding
// Resolves address to coordinates via Nominatim with Nairobi bounds check
// -----------------------------------------------------------------
app.post('/api/intake/geocode', async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) {
      return res.status(400).json({ error: 'Field "address" is required.' });
    }

    const result = await geocodeAddress(address);
    return res.json(result);
  } catch (err) {
    console.error('Error geocoding address:', err);
    return res.status(500).json({ error: 'Internal server error geocoding address.', details: err.message });
  }
});

// -----------------------------------------------------------------
// INTAKE ENDPOINT 3: Validate & Verify Coordinates
// Checks if coordinates are within Nairobi and Copernicus DEM coverage
// -----------------------------------------------------------------
app.post('/api/intake/validate-coords', (req, res) => {
  const { lat, lon } = req.body;
  if (lat == null || lon == null) {
    return res.status(400).json({ error: 'Fields "lat" and "lon" are required.' });
  }

  const check = validateNairobiCoordinates(parseFloat(lat), parseFloat(lon));
  return res.json(check);
});

// -----------------------------------------------------------------
// INTAKE ENDPOINT 4: Demo Fixture (Landmark Plaza)
// Returns instant pre-extracted canonical record for quick UI demo
// -----------------------------------------------------------------
app.get('/api/intake/demo/landmark', async (req, res) => {
  try {
    const slipPath = path.join(__dirname, 'data/sample_placement_slip.txt');
    if (!fs.existsSync(slipPath)) {
      return res.status(404).json({ error: 'Sample slip not found on server.' });
    }
    const slipText = fs.readFileSync(slipPath, 'utf-8');
    const canonical = await processBrokerSlip(slipText);
    return res.json({
      raw_text: slipText,
      canonical
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load demo fixture.', details: err.message });
  }
});

// Fallback route to serve index.html for client-side routing
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send(`
      <html>
        <head><title>Kenya Re CatNet API</title></head>
        <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem;">
          <h2>🌊 Kenya Re — Nairobi Flood CatNet Engine Active</h2>
          <p>Express API Gateway is running on port ${PORT}.</p>
          <p>Available endpoints:</p>
          <ul>
            <li><code>GET /api/health</code></li>
            <li><code>POST /api/intake/parse-slip</code></li>
            <li><code>POST /api/intake/geocode</code></li>
            <li><code>GET /api/intake/demo/landmark</code></li>
          </ul>
        </body>
      </html>
    `);
  }
});

// Start server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`========================================================`);
    console.log(` 🚀 Kenya Re CatNet Backend running on http://localhost:${PORT}`);
    console.log(` 📋 Ingestion API ready for Dev 1 (RAG) and Dev 2 (UI)`);
    console.log(`========================================================`);
  });
}

module.exports = app;
