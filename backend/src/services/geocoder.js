/**
 * OpenStreetMap Nominatim Geocoding Client
 * Resolves street addresses to GPS coordinates when not stated in the broker slip.
 * Adheres to Nominatim usage policy (custom User-Agent & timeout).
 */

const { validateNairobiCoordinates } = require('./bounds');

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "KenyaRe-CatNet-NairobiFloodModel/1.0 (underwriting@kenyare.co.ke)";

// In-memory cache to prevent redundant HTTP lookups
const geocodeCache = new Map();

/**
 * Geocodes an address string using OpenStreetMap Nominatim
 * @param {string} address - Free text address e.g. "Lot 12, Upper Hill Area, Nairobi"
 * @returns {Promise<{success: boolean, candidates: Array, error?: string}>}
 */
async function geocodeAddress(address) {
  if (!address || typeof address !== 'string' || address.trim().length === 0) {
    return { success: false, candidates: [], error: 'Address string is required.' };
  }

  const query = address.trim();
  const cacheKey = query.toLowerCase();
  if (geocodeCache.has(cacheKey)) {
    return { success: true, candidates: geocodeCache.get(cacheKey) };
  }

  // Ensure query includes Nairobi if not already present
  const fullQuery = query.toLowerCase().includes('nairobi') ? query : `${query}, Nairobi, Kenya`;

  try {
    const url = new URL(NOMINATIM_BASE);
    url.searchParams.set('q', fullQuery);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '5');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('countrycodes', 'ke');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { success: false, candidates: [], error: `Geocoding service returned status ${response.status}` };
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      return { success: false, candidates: [], error: `No locations found for "${query}".` };
    }

    const candidates = data.map(item => {
      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);
      const boundsCheck = validateNairobiCoordinates(lat, lon);

      return {
        display_name: item.display_name,
        lat,
        lon,
        is_inside_nairobi: boundsCheck.isValid,
        is_within_raster: boundsCheck.isWithinRaster,
        importance: item.importance || 0
      };
    });

    geocodeCache.set(cacheKey, candidates);
    return { success: true, candidates };
  } catch (err) {
    return {
      success: false,
      candidates: [],
      error: `Geocoding request failed: ${err.message}`
    };
  }
}

module.exports = {
  geocodeAddress
};
