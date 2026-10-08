/**
 * Master Intake Orchestrator (Module 0 Pipeline)
 * Coordinates Extraction -> Geocoding -> Fallbacks -> Canonical Schema
 */

const { extractFromSlip } = require('./mockRAG');
const { applyFallbacks } = require('./fallbackEngine');
const { geocodeAddress } = require('../services/geocoder');

/**
 * Orchestrates the full intake workflow from raw text to canonical exposure
 * @param {string|Object} input - Raw text of broker slip, or pre-extracted object
 * @param {Object} [options] - Manual overrides (e.g. human pin coords, DEM elevation)
 * @returns {Promise<Object>} Canonical Exposure Record with full source tags and blocker flags
 */
async function processBrokerSlip(input, options = {}) {
  let rawData = {};

  if (typeof input === 'string') {
    rawData = extractFromSlip(input);
  } else if (typeof input === 'object' && input !== null) {
    rawData = { ...input };
  }

  // Merge any manual overrides passed into the pipeline
  if (options.overrides) {
    rawData = { ...rawData, ...options.overrides };
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

  return canonical;
}

module.exports = {
  processBrokerSlip
};
