/**
 * Flatten Gemini extractExposure output into the orchestrator's raw map.
 */
function flattenGemini(data) {
  if (!data || typeof data !== "object") return {};
  const raw = {};
  if (data.property_name) raw.property_name = data.property_name;
  if (data.reference) raw.reference = data.reference;
  const coords = data.coordinates || {};
  if (coords.lat != null) raw.lat = coords.lat;
  if (coords.lon != null) raw.lon = coords.lon;
  if (coords.elevation_m != null) raw.elevation_m = coords.elevation_m;
  const exp = data.exposure || {};
  [
    "housing_class",
    "floor_area_m2",
    "floors_above_ground",
    "total_height_m",
    "basement_floors",
    "critical_plant_in_basement",
    "tiv_kes",
    "cost_per_m2_kes"
  ].forEach((key) => {
    if (exp[key] != null) raw[key] = exp[key];
  });
  const fin = data.financial_terms || {};
  if (fin.deductible_pct != null) raw.deductible_pct = fin.deductible_pct;
  if (fin.deductible_min_kes != null) raw.deductible_min_kes = fin.deductible_min_kes;
  if (Array.isArray(fin.vital_considerations)) {
    raw.vital_considerations = fin.vital_considerations;
  }
  return raw;
}

function mergeRaw(base, extra) {
  const out = { ...base };
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (value == null || value === "") return;
    if (out[key] == null || out[key] === "") out[key] = value;
  });
  return out;
}

function regexLooksComplete(raw) {
  return Boolean(
    raw &&
    raw.lat != null &&
    raw.lon != null &&
    raw.housing_class &&
    raw.tiv_kes != null
  );
}

module.exports = { flattenGemini, mergeRaw, regexLooksComplete };
