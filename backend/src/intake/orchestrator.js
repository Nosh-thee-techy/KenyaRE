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
  const images = options.images || [];
  if (typeof input === 'string') {
    rawData = extractFromSlip(input);
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && !regexLooksComplete(rawData)) {
      try {
        const gemini = await extractExposure(input, apiKey, { images });
        rawData = mergeRaw(rawData, flattenGemini(gemini));
      } catch (err) {
        console.error('Gemini extraction failed:', err && err.message ? err.message : err);
        const msg = err && err.message ? String(err.message).slice(0, 180) : 'error';
        geminiNote = `Gemini extraction skipped (${msg}).`;
      }
    } else if (!apiKey && !regexLooksComplete(rawData) && images.length) {
      geminiNote = 'Gemini extraction skipped (no API key). Image/scan text could not be read.';
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

  // Look up an address when GPS is missing — do not auto-apply; underwriter confirms.
  let geocodeSuggestion = options.geocodeSuggestion || null;
  if (
    !geocodeSuggestion &&
    (rawData.lat == null || rawData.lon == null) &&
    !options.humanCoords
  ) {
    const query = rawData.address || rawData.property_name;
    if (query) {
      const geoResult = await geocodeAddress(query);
      if (geoResult.success && geoResult.candidates.length > 0) {
        const best =
          geoResult.candidates.find((c) => c.is_inside_nairobi) ||
          geoResult.candidates[0];
        if (best) {
          geocodeSuggestion = {
            query: String(query),
            label: best.display_name,
            lat: best.lat,
            lon: best.lon,
            is_inside_nairobi: Boolean(best.is_inside_nairobi)
          };
        }
      }
    }
  }

  const canonical = applyFallbacks(rawData, {
    ...options,
    geocodeSuggestion
  });

  if (geminiNote) {
    canonical.audit.warnings.push(geminiNote);
  }

  return canonical;
}

module.exports = {
  processBrokerSlip
};
