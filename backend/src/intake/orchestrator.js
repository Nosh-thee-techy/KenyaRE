/**
 * Master Intake Orchestrator (Module 0 Pipeline)
 * Coordinates Extraction -> Geocoding -> Fallbacks -> Canonical Schema
 */

const { extractFromSlip } = require('./mockRAG');
const { applyFallbacks } = require('./fallbackEngine');
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
        const gemini = await Promise.race([
          extractExposure(input, apiKey, { images, skipRag: true }),
          new Promise((_, reject) => {
            const ms = images.length ? 18000 : 12000;
            setTimeout(() => reject(new Error("Gemini timed out after " + ms / 1000 + "s")), ms);
          })
        ]);
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

  // Nominatim is done on the intake page after paint so parse is not blocked.
  let geocodeSuggestion = options.geocodeSuggestion || null;

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
