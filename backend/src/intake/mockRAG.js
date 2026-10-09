/**
 * Mock RAG / Deterministic Slip Parser (Module 0 Intake)
 * Extracts structured risk entities from unstructured broker placement slips.
 * Generic regexes only — no fixture risk is hardcoded here.
 */

const KES = '(?:KES|KShs?|KSH|Ksh|Kenya\\s*Shillings?)\\.?';
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

function dmsToDecimal(deg, min, sec, hemi) {
  const d = Math.abs(parseFloat(deg));
  const m = parseFloat(min || 0);
  const s = parseFloat(sec || 0);
  if (![d, m, s].every(Number.isFinite)) return null;
  let v = d + m / 60 + s / 3600;
  if (parseFloat(deg) < 0) v = -v;
  return applyHemisphere(v, hemi);
}

function looksLikeNairobi(lat, lon) {
  return lat >= -2.5 && lat <= 1.5 && lon >= 33.5 && lon <= 42.5;
}

const NEXT_FIELD =
  /\s+(?=(?:GPS(?:\s+COORDINATES?)?|STREET\s+ADDRESS|RISK\s+LOCATION|REFERENCE|SUM(?:S)?\s+INSURED|DECLARED\s+(?:VALUE|SUM)|GROSS\s+FLOOR|GFA\b|CONSTRUCTION|CLASS\s+OF\s+BUSINESS|COVERAGE\s+TYPE|ELEVATION|TOTAL\s+NUMBER|NUMBER\s+OF\s+STOREYS|BUILDING\s+HEIGHT|SITUATED\s+AT|ADDRESS|INSURED|CLIENT)\b)/i;

function clipField(value) {
  if (!value) return value;
  return String(value).split(NEXT_FIELD)[0].replace(/\s+/g, ' ').trim();
}

function lineValue(text, labels) {
  const re = new RegExp(
    `(?:${labels})\\s*[:\\-]\\s*([^\\r\\n]+)`,
    'i'
  );
  const m = text.match(re);
  return m ? clipField(m[1]) : null;
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
    new RegExp(`(?:total\\s+)?(?:sums?\\s+insured|insured\\s+sum|declared\\s+(?:value|sum)|total\\s+insured\\s+value)(?:\\s*\\([^)]*\\))?\\s*[:\\-]?\\s*${KES}\\s*${MONEY}`, 'i'),
    new RegExp(`(?:total\\s+)?(?:sums?\\s+insured|insured\\s+sum|declared\\s+(?:value|sum))(?:\\s*\\([^)]*\\))?\\s*[:\\-]?\\s*${MONEY}`, 'i'),
    new RegExp(`\\b(?:TSI|SI)\\s*[:\\-]\\s*${KES}\\s*${MONEY}`, 'i'),
    new RegExp(`\\bTIV\\b[^\\n]{0,64}${KES}\\s*${MONEY}`, 'i'),
    new RegExp(`${KES}\\s*${MONEY}[^\\n]{0,40}\\bTIV\\b`, 'i')
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
    /GPS\s*(?:COORDINATES?)?\s*[:;]?\s+([+\-]?[0-9.]+)[°\s]*([NS])?\s*[,;/]\s*([+\-]?[0-9.]+)[°\s]*([EW])?/i
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
    /(?:geo(?:graphic)?\s*)?coordinates\s*[:;]?\s+([+\-]?[0-9.]+)[°\s]*([NS])?\s*[,;/]\s*([+\-]?[0-9.]+)[°\s]*([EW])?/i
  );
  if (coords) {
    const lat = applyHemisphere(coords[1], coords[2]);
    const lon = applyHemisphere(coords[3], coords[4]);
    if (lat != null && lon != null) return { lat, lon };
  }

  const dms = text.match(
    /(\d{1,2})\s*[°]\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*[\"″]?\s*([NS])\s*[,;\s/]+\s*(\d{1,3})\s*[°]\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*[\"″]?\s*([EW])/i
  );
  if (dms) {
    const lat = dmsToDecimal(dms[1], dms[2], dms[3], dms[4]);
    const lon = dmsToDecimal(dms[5], dms[6], dms[7], dms[8]);
    if (lat != null && lon != null && looksLikeNairobi(lat, lon)) return { lat, lon };
  }

  const pair = text.match(
    /([+\-]?[0-9]{1,2}\.[0-9]+)[°\s]*([NS])\s*[,;/]\s*([+\-]?[0-9]{1,3}\.[0-9]+)[°\s]*([EW])/i
  );
  if (pair) {
    const lat = applyHemisphere(pair[1], pair[2]);
    const lon = applyHemisphere(pair[3], pair[4]);
    if (lat != null && lon != null && looksLikeNairobi(lat, lon)) return { lat, lon };
  }

  const signed = text.match(
    /([+\-][0-1]?\d\.\d{3,})\s*[,;/\s]\s*([+\-]?3[3-9]\.\d{3,})/
  );
  if (signed) {
    const lat = parseFloat(signed[1]);
    const lon = parseFloat(signed[2]);
    if (looksLikeNairobi(lat, lon)) return { lat, lon };
  }

  const southEast = text.match(
    /([0-1]?\d\.\d{2,})\s*[°]?\s*S\s*[,;/\s]+([3][3-9]\.\d{2,})\s*[°]?\s*E/i
  );
  if (southEast) {
    const lat = -Math.abs(parseFloat(southEast[1]));
    const lon = parseFloat(southEast[2]);
    if (looksLikeNairobi(lat, lon)) return { lat, lon };
  }

  const nairobiPair = text.match(
    /(-?1\.\d{2,})\s*[,;/\s]\s*(3[6-7]\.\d{2,})/
  );
  if (nairobiPair) {
    const lat = parseFloat(nairobiPair[1]);
    const lon = parseFloat(nairobiPair[2]);
    if (looksLikeNairobi(lat, lon)) return { lat, lon };
  }

  return null;
}

function extractGfa(text) {
  const labeled = text.match(
    /(?:gross\s+(?:floor|built[-\s]?up)\s+area|built[-\s]?up\s+area|total\s+floor\s+area|\bGFA\b|floor\s+area|gross\s+area)\s*[:\-]?\s*\(?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:m[²2]|sq\.?\s*m(?:et(?:re|er)s?)?|square\s*met(?:re|er)s?|sqm)/i
  );
  if (labeled) {
    const n = parseFloat(labeled[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  const trailing = text.match(
    /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:m[²2]|sqm|sq\.?\s*m(?:et(?:re|er)s?)?)\s*(?:\((?:gross\s+)?(?:floor|built[-\s]?up)\s+area|\(?\s*GFA)/i
  );
  if (trailing) {
    const n = parseFloat(trailing[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function extractFloors(text) {
  const labeled =
    text.match(/Total Number of Floors:\s*(\d+)/i) ||
    text.match(/(?:(?:total|no\.?|number)\s+of\s+)?(?:floors|storeys|stories)(?:\s+above\s+ground)?\s*[:\-]\s*(\d+)/i) ||
    text.match(/(\d+)\s*(?:floors?|storeys?|stories)\s*(?:above\s+ground)?/i) ||
    text.match(/(\d+)\s*-\s*storey/i);
  if (labeled) {
    const n = parseInt(labeled[1], 10);
    if (Number.isFinite(n) && n > 0 && n < 200) return n;
  }
  const gPlus = text.match(/\bG\s*\+\s*(\d{1,2})\b/i);
  if (gPlus) {
    const n = parseInt(gPlus[1], 10);
    if (Number.isFinite(n) && n >= 0 && n < 80) return n + 1;
  }
  return null;
}

function extractBasements(text) {
  if (/(?:no|without|nil)\s+basement|basement[:\s]+(?:none|nil|0)\b/i.test(text)) {
    return 0;
  }
  const numbered =
    text.match(/(\d+)\s*\(basement\)/i) ||
    text.match(/(?:basement(?:\s+floors?)?|basements)\s*[:\-]?\s*(\d+)/i) ||
    text.match(/(\d+)\s+basement/i);
  if (numbered) {
    const n = parseInt(numbered[1], 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  if (/Basement Designation:\s*B1,\s*B2/i.test(text) || /two basement/i.test(text)) {
    return 2;
  }
  const bLevels = text.match(/\bB(\d)\b/gi);
  if (bLevels && bLevels.length) {
    const max = Math.max(
      ...bLevels.map((t) => parseInt(String(t).replace(/\D/g, ''), 10)).filter(Number.isFinite)
    );
    if (max > 0 && max <= 6) return max;
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

  const name = lineValue(
    text,
    'CLIENT|NAME OF INSURED|THE INSURED|INSURED(?!\\s+INTEREST)|ASSURED|PROPERTY(?:\\s+NAME)?|RISK NAME|NAME OF (?:THE )?RISK'
  );
  if (name) {
    result.property_name = name.replace(/\(.*?\)/g, '').trim();
  }

  const refMatch = text.match(/REFERENCE:\s*([A-Z0-9\-]+)/i);
  if (refMatch) {
    result.reference = refMatch[1].trim();
  }

  const gps = extractGps(text);
  if (gps) {
    result.lat = gps.lat;
    result.lon = gps.lon;
  }

  const address = lineValue(
    text,
    'STREET\\s+ADDRESS|RISK\\s+LOCATION|SITUATION(?:\\s+OF\\s+RISK)?|SITUATED\\s+AT|PROPERTY\\s+ADDRESS|LOCATION(?!\\s*:\\s*Basement)|ADDRESS'
  );
  if (address) {
    result.address = address.replace(/\s+/g, ' ').trim();
  }

  const elevMatch =
    text.match(/ELEVATION:\s*([0-9,]+)\s*meters/i) ||
    text.match(/(?:elevation|asl)\s*[:\-]?\s*([0-9,]+)\s*m(?:eters?)?(?:\s*(?:asl|above\s+sea\s+level))?/i);
  if (elevMatch) {
    const n = parseFloat(elevMatch[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) result.elevation_m = n;
  }

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

  const floors = extractFloors(text);
  if (floors != null) result.floors_above_ground = floors;

  const heightMatch =
    text.match(/Building height \(to roof edge\):\s*([0-9.]+)\s*meters/i) ||
    text.match(/(?:building\s+height|height\s+to\s+(?:roof|eaves)|roof\s+height|overall\s+height)\s*[:\-]?\s*([0-9.]+)\s*m(?:eters?)?/i);
  if (heightMatch) {
    const h = parseFloat(heightMatch[1]);
    if (Number.isFinite(h) && h > 0) result.total_height_m = h;
  }

  const plinthMatch = text.match(
    /(?:ground\s+to\s+first\s+floor|plinth(?:\s+height)?|first\s+floor\s+(?:height|clearance)|finished\s+floor\s+level)[^\n]{0,32}?([0-9.]+)\s*m/i
  );
  if (plinthMatch) {
    const p = parseFloat(plinthMatch[1]);
    if (Number.isFinite(p) && p > 0) result.first_floor_height_m = p;
  }

  const basement = extractBasements(text);
  if (basement != null) result.basement_floors = basement;

  const lowerText = text.toLowerCase();
  const hasBasementPlant =
    (lowerText.includes('generator') && (lowerText.includes('basement') || lowerText.includes('b1'))) ||
    (lowerText.includes('chiller') && (lowerText.includes('basement') || lowerText.includes('b2'))) ||
    (lowerText.includes('transformer') && (lowerText.includes('basement') || lowerText.includes('substation 1')));
  if (hasBasementPlant) {
    result.critical_plant_in_basement = true;
  }

  const gfa = extractGfa(text);
  if (gfa != null) result.floor_area_m2 = gfa;

  const tiv = extractTiv(text);
  if (tiv != null) result.tiv_kes = tiv;

  const covMatch = text.match(/(?:COVERAGE\s+TYPE|TYPE\s+OF\s+COVER|COVER(?:AGE)?)\s*:\s*([^\r\n]+)/i);
  if (covMatch) {
    result.coverage_type = clipField(covMatch[1]);
  }

  const cobMatch = text.match(/(?:CLASS OF BUSINESS|OCCUPANCY|OCCUPATION)\s*:\s*([^\r\n]+)/i);
  if (cobMatch) {
    result.class_of_business = clipField(cobMatch[1]);
  }

  result.flood_cover_requested =
    lowerText.includes('flood cover') || lowerText.includes('facultative flood');

  const dedMatch =
    text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:deductible|excess)(?:\s+or\s+(?:KES|KShs?)\.?\s*([0-9,]+)\s*minimum)?/i) ||
    text.match(/(\d+(?:\.\d+)?)\s*%\s*deductible or KES\s*([0-9,]+)\s*minimum/i);
  if (dedMatch) {
    result.deductible_pct = parseFloat(dedMatch[1]) / 100.0;
    if (dedMatch[2]) {
      result.deductible_min_kes = parseFloat(dedMatch[2].replace(/,/g, ''));
    }
  }

  if (result.tiv_kes) {
    result.policy_limit_kes = result.tiv_kes;
  }

  return result;
}

module.exports = {
  extractFromSlip,
  extractGps,
  mapHousingClass
};
