/**
 * Mock RAG / Deterministic Slip Parser (Module 0 Intake)
 * Extracts structured risk entities from unstructured broker placement slips.
 * Generic regexes only — no fixture risk is hardcoded here.
 */

const KES = '(?:KES|KShs?|KSH|Ksh|Kenya\\s*Shillings?)';
const MONEY = `([0-9][0-9,.\\s]*(?:\\s*(?:billion|bn|million|mn))?)`;

function parseAmountToken(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/,/g, '').replace(/\s+/g, ' ').trim();
  const m = s.match(/^([\d.]+)\s*(bn|billion|mn|million)?$/i);
  if (!m) {
    const n = parseFloat(s.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  let n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'bn' || unit === 'billion') n *= 1e9;
  else if (unit === 'mn' || unit === 'million') n *= 1e6;
  return n;
}

function applyHemisphere(value, hemi) {
  let v = parseFloat(value);
  if (!Number.isFinite(v)) return null;
  const h = (hemi || '').toUpperCase();
  if (h === 'S' && v > 0) v = -v;
  if (h === 'W' && v > 0) v = -v;
  return v;
}

function looksLikeNairobi(lat, lon) {
  return lat >= -2.5 && lat <= 1.5 && lon >= 33.5 && lon <= 42.5;
}

/**
 * Map construction wording to a kit class. Returns null when unrecognised.
 * RCC / reinforced concrete wins over brick/masonry mentions (e.g. infill).
 */
function mapHousingClass(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  if (
    /\brcc\b/.test(t) ||
    /reinforced\s+concrete/.test(t) ||
    /concrete\s+frame/.test(t) ||
    /moment[-\s]?resisting\s+frame/.test(t) ||
    /shear\s+walls?/.test(t)
  ) {
    return 'concrete_rcc';
  }
  if (
    /\bmabati\b/.test(t) ||
    /iron\s*sheets?/.test(t) ||
    /corrugated\s+iron/.test(t) ||
    /cgi\s+sheet/.test(t)
  ) {
    return 'informal_iron_sheet';
  }
  if (
    /semi[-\s]?permanent/.test(t) ||
    /timber\s+frame/.test(t) ||
    /mud\s+plaster/.test(t)
  ) {
    return 'semi_permanent';
  }
  if (
    /\bmasonry\b/.test(t) ||
    /\bbrick\b/.test(t) ||
    /\bstone\b/.test(t) ||
    /blockwork/.test(t) ||
    /concrete\s+blocks?/.test(t) ||
    /quarry\s+stone/.test(t)
  ) {
    return 'permanent_masonry';
  }
  return null;
}

function extractTiv(text) {
  const patterns = [
    new RegExp(`full\\s+TIV\\s*\\(\\s*${KES}\\s*${MONEY}\\s*\\)`, 'i'),
    new RegExp(`\\bTIV\\s*[:\\-]\\s*${KES}\\s*${MONEY}`, 'i'),
    new RegExp(`(?:total\\s+)?sums?\\s+insured(?:\\s*\\([^)]*\\))?\\s*[:\\-]?\\s*${KES}\\s*${MONEY}`, 'i'),
    new RegExp(`(?:total\\s+)?sums?\\s+insured(?:\\s*\\([^)]*\\))?\\s*[:\\-]?\\s*${MONEY}`, 'i'),
    new RegExp(`\\b(?:TSI|SI)\\s*[:\\-]\\s*${KES}\\s*${MONEY}`, 'i'),
    new RegExp(`\\bTIV\\b[^\\n]{0,48}${KES}\\s*${MONEY}`, 'i')
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const n = parseAmountToken(m[1]);
    if (n != null && n >= 1000) return n;
  }
  return null;
}

function extractGps(text) {
  const labeled = text.match(
    /GPS\s*COORDINATES?\s*:\s*([+\-]?[0-9.]+)[°\s]*([NS])?\s*[,;/]\s*([+\-]?[0-9.]+)[°\s]*([EW])?/i
  );
  if (labeled) {
    const lat = applyHemisphere(labeled[1], labeled[2]);
    const lon = applyHemisphere(labeled[3], labeled[4]);
    if (lat != null && lon != null) return { lat, lon };
  }

  const latLon = text.match(
    /(?:lat(?:itude)?)\s*[:\s]+([+\-]?[0-9.]+)[°]?\s*([NS])?[,;\s]+(?:lon(?:g(?:itude)?)?)\s*[:\s]+([+\-]?[0-9.]+)[°]?\s*([EW])?/i
  );
  if (latLon) {
    const lat = applyHemisphere(latLon[1], latLon[2]);
    const lon = applyHemisphere(latLon[3], latLon[4]);
    if (lat != null && lon != null) return { lat, lon };
  }

  const coords = text.match(
    /(?:geo(?:graphic)?\s*)?coordinates\s*:\s*([+\-]?[0-9.]+)[°\s]*([NS])?\s*[,;/]\s*([+\-]?[0-9.]+)[°\s]*([EW])?/i
  );
  if (coords) {
    const lat = applyHemisphere(coords[1], coords[2]);
    const lon = applyHemisphere(coords[3], coords[4]);
    if (lat != null && lon != null) return { lat, lon };
  }

  const pair = text.match(
    /([+\-]?[0-9]{1,2}\.[0-9]+)[°\s]*([NS])\s*[,;/]\s*([+\-]?[0-9]{1,3}\.[0-9]+)[°\s]*([EW])/i
  );
  if (pair) {
    const lat = applyHemisphere(pair[1], pair[2]);
    const lon = applyHemisphere(pair[3], pair[4]);
    if (lat != null && lon != null && looksLikeNairobi(lat, lon)) return { lat, lon };
  }

  return null;
}

function extractGfa(text) {
  const labeled = text.match(
    /(?:gross\s+floor\s+area|total\s+floor\s+area|\bGFA\b|floor\s+area)\s*[:\-]?\s*\(?\s*([0-9][0-9,]*)\s*(?:m[²2]|sq\.?\s*m(?:et(?:re|er)s?)?|sqm)/i
  );
  if (labeled) {
    const n = parseFloat(labeled[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  const trailing = text.match(
    /([0-9][0-9,]*)\s*(?:m[²2]|sqm)\s*(?:\((?:gross\s+)?floor\s+area|\(?\s*GFA)/i
  );
  if (trailing) {
    const n = parseFloat(trailing[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * Parses raw text from a reinsurance broker slip
 * @param {string} text - The raw text of the broker memorandum
 * @returns {Object} Extracted raw entity map
 */
function extractFromSlip(text = '') {
  const result = {};

  if (!text || typeof text !== 'string') {
    return result;
  }

  // 1. Client / Property Name
  const clientMatch = text.match(/(?:CLIENT|INSURED|ASSURED)\s*:\s*([^\r\n]+)/i);
  if (clientMatch) {
    result.property_name = clientMatch[1].replace(/\(.*?\)/g, '').trim();
  }

  const refMatch = text.match(/REFERENCE:\s*([A-Z0-9\-]+)/i);
  if (refMatch) {
    result.reference = refMatch[1].trim();
  }

  // 2. GPS
  const gps = extractGps(text);
  if (gps) {
    result.lat = gps.lat;
    result.lon = gps.lon;
  }

  const addrMatch = text.match(/(?:STREET\s+ADDRESS|ADDRESS|SITUATED\s+AT)\s*:\s*([^\r\n]+)/i);
  if (addrMatch) {
    result.address = addrMatch[1].trim();
  }

  const elevMatch = text.match(/ELEVATION:\s*([0-9,]+)\s*meters/i);
  if (elevMatch) {
    result.elevation_m = parseFloat(elevMatch[1].replace(/,/g, ''));
  }

  // 3. Construction — labelled line first, then whole-slip wording. Never default.
  const constrMatch = text.match(
    /(?:CONSTRUCTION\s+CLASSIFICATION|CONSTRUCTION\s+CLASS|CONSTRUCTION\s+TYPE|TYPE\s+OF\s+CONSTRUCTION|BUILDING\s+(?:CLASS|CONSTRUCTION|TYPE)|CONSTRUCTION)\s*:\s*([^\r\n]+)/i
  );
  if (constrMatch) {
    const mapped = mapHousingClass(constrMatch[1]);
    if (mapped) result.housing_class = mapped;
  }
  if (!result.housing_class) {
    const mapped = mapHousingClass(text);
    if (mapped) result.housing_class = mapped;
  }

  // 4. Floors & Height
  const floorsMatch =
    text.match(/Total Number of Floors:\s*(\d+)/i) ||
    text.match(/(\d+)\s*(?:floors?|storeys?|stories)\s*(?:above\s+ground)?/i);
  if (floorsMatch) {
    result.floors_above_ground = parseInt(floorsMatch[1], 10);
  }

  const heightMatch =
    text.match(/Building height \(to roof edge\):\s*([0-9.]+)\s*meters/i) ||
    text.match(/(?:building\s+height|height\s+to\s+(?:roof|eaves))\s*[:\-]?\s*([0-9.]+)\s*m(?:eters?)?/i);
  if (heightMatch) {
    result.total_height_m = parseFloat(heightMatch[1]);
  }

  const basementMatch =
    text.match(/(\d+)\s*\(basement\)/i) ||
    text.match(/Basement Designation:\s*B1,\s*B2/i) ||
    text.match(/two basement/i) ||
    text.match(/(\d+)\s*basement/i);
  if (basementMatch) {
    const n = parseInt(basementMatch[1], 10);
    result.basement_floors = Number.isFinite(n) && n > 0 ? n : 2;
  }

  const lowerText = text.toLowerCase();
  const hasBasementPlant =
    (lowerText.includes('generator') && (lowerText.includes('basement') || lowerText.includes('b1'))) ||
    (lowerText.includes('chiller') && (lowerText.includes('basement') || lowerText.includes('b2'))) ||
    (lowerText.includes('transformer') && (lowerText.includes('basement') || lowerText.includes('substation 1')));
  result.critical_plant_in_basement = hasBasementPlant;

  // 5. Floor Area (GFA)
  const gfa = extractGfa(text);
  if (gfa != null) result.floor_area_m2 = gfa;

  // 6. Valuation (TIV) — declared sum insured only; never inferred here
  const tiv = extractTiv(text);
  if (tiv != null) result.tiv_kes = tiv;

  // 7. Coverage & Subject
  const covMatch = text.match(/COVERAGE TYPE:\s*([^\r\n]+)/i);
  if (covMatch) {
    result.coverage_type = covMatch[1].trim();
  }

  const cobMatch = text.match(/CLASS OF BUSINESS:\s*([^\r\n]+)/i);
  if (cobMatch) {
    result.class_of_business = cobMatch[1].trim();
  }

  result.flood_cover_requested = lowerText.includes('flood cover') || lowerText.includes('facultative flood');

  // 8. Deductible & Policy Limit
  const dedMatch = text.match(/(\d+)%\s*deductible or KES\s*([0-9,]+)\s*minimum/i);
  if (dedMatch) {
    result.deductible_pct = parseFloat(dedMatch[1]) / 100.0;
    result.deductible_min_kes = parseFloat(dedMatch[2].replace(/,/g, ''));
  }

  if (result.tiv_kes) {
    result.policy_limit_kes = result.tiv_kes;
  }

  return result;
}

module.exports = {
  extractFromSlip,
  mapHousingClass
};
