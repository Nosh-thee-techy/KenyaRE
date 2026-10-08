/**
 * Master Intake Orchestrator (Module 0 Pipeline)
 * Coordinates Extraction -> Geocoding -> Fallbacks -> Canonical Schema
 */

const { extractFromSlip } = require('./mockRAG');
const { applyFallbacks } = require('./fallbackEngine');
const { geocodeAddress } = require('../services/geocoder');
const { extractExposure } = require('../services/extraction.service');
const { flattenGemini, mergeRaw, regexLooksComplete } = require('./geminiBridge');

/**
 * Orchestrates the full intake workflow from raw text to canonical exposure
 * @param {string|Object} input - Raw text of broker slip, or pre-extracted object
 * @param {Object} [options] - Manual overrides (e.g. human pin coords, DEM elevation)
 * @returns {Promise<Object>} Canonical Exposure Record with full source tags and blocker flags
 */
async function processBrokerSlip(input, options = {}) {
  let rawData = {};

  let geminiNote = null;
  if (typeof input === 'string') {
    rawData = extractFromSlip(input);
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && !regexLooksComplete(rawData)) {
      try {
        const gemini = await extractExposure(input, apiKey);
        rawData = mergeRaw(rawData, flattenGemini(gemini));
      } catch (err) {
        const msg = err && err.message ? String(err.message).slice(0, 180) : 'error';
        geminiNote = `Gemini extraction skipped (${msg}).`;
      }
    }
  } else if (typeof input === 'object' && input !== null) {
    rawData = { ...input };
  }

  if (options.overrides) {
    rawData = { ...rawData, ...options.overrides };
    if (options.overrides.lat != null && options.overrides.lon != null) {
      options.humanCoords = {
        lat: options.overrides.lat,
        lon: options.overrides.lon
      };
    }
  }

  // Fallback Geocoding: If coordinates are missing, attempt Nominatim lookup
  let geocodedCoords = null;
  if ((rawData.lat == null || rawData.lon == null) && rawData.address) {
    const geoResult = await geocodeAddress(rawData.address);
    if (geoResult.success && geoResult.candidates.length > 0) {
      // Pick the top valid candidate within Nairobi
      const best = geoResult.candidates.find(c => c.is_inside_nairobi) || geoResult.candidates[0];
      if (best) {
        geocodedCoords = { lat: best.lat, lon: best.lon };
      }
    }
  }

  // Apply the deterministic fallback engine
  const canonical = applyFallbacks(rawData, {
    ...options,
    geocodedCoords: geocodedCoords || options.geocodedCoords
  });

  if (geminiNote) {
    canonical.audit.warnings.push(geminiNote);
  }

  return canonical;
}

module.exports = {
  processBrokerSlip
};
