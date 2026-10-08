/**
 * Canonical Exposure Schema & Source Tagging Specification
 * 
 * Locked specification per docs/INTAKE.md and docs/ARCHITECTURE.md
 * Every scalar in the canonical schema must be tagged with its provenance.
 */

const VALID_SOURCES = Object.freeze([
  'extracted',     // Read directly from the broker document
  'geocoded',      // Resolved via OpenStreetMap Nominatim from text address
  'dem',           // Sampled from Copernicus GLO-30 DEM raster
  'implied',       // Mathematically derived from other stated numbers (e.g. area * rate)
  'derived',       // Inferred from business logic / context (e.g. occupancy, cover_subject)
  'class_default', // Standard fallback assigned based on building class
  'human'          // Interactively provided or overridden by the underwriter
]);

const VALID_HOUSING_CLASSES = Object.freeze([
  'informal_iron_sheet', // Mabati shacks, timber poles, dirt/thin screed floor
  'semi_permanent',      // Timber frame, unreinforced brick, mud plaster
  'permanent_masonry',   // Stone bungalow, concrete mortar, tile/iron roof
  'concrete_rcc'         // Multi-storey reinforced concrete columns & shear walls
]);

const VALID_COVER_SUBJECTS = Object.freeze([
  'building', // Structure rebuilding only
  'assets',   // Contents/machinery/stock only
  'both'      // Both building and assets bundled under one TIV
]);

/**
 * Creates a tagged scalar value: { value, source }
 * @param {*} value - The scalar value
 * @param {string} source - One of the VALID_SOURCES
 * @returns {{value: *, source: string}}
 */
function tagged(value, source) {
  if (!VALID_SOURCES.includes(source)) {
    throw new Error(`Invalid source tag: "${source}". Allowed: ${VALID_SOURCES.join(', ')}`);
  }
  return { value, source };
}

/**
 * Factory for creating a clean, empty Canonical Exposure Object
 */
function createCanonicalRecord() {
  return {
    property_name: null,
    reference: null,
    coordinates: {
      lat: null,          // { value: float, source: string }
      lon: null,          // { value: float, source: string }
      elevation_m: null,  // { value: float, source: string }
      elevation_m_dem: null // { value: float, source: string } (if DEM differs > 5m)
    },
    exposure: {
      housing_class: null,              // { value: string, source: string }
      occupancy: null,                  // { value: string, source: string }
      floor_area_m2: null,              // { value: float, source: string }
      floors_above_ground: null,        // { value: int, source: string }
      total_height_m: null,             // { value: float, source: string }
      basement_floors: null,            // { value: int, source: string }
      first_floor_height_m: null,       // { value: float, source: string }
      critical_plant_in_basement: null, // { value: boolean, source: string }
      tiv_kes: null,                    // { value: float, source: string }
      cost_per_m2_kes: null             // { value: float, source: string }
    },
    coverage: {
      class_of_business: null,          // { value: string, source: string }
      coverage_type: null,              // { value: string, source: string }
      flood_cover_requested: null,      // { value: boolean, source: string }
      cover_subject: null,              // { value: string, source: string }
      insured_interest: []              // string[]
    },
    financial_terms: {
      deductible_pct: null,             // { value: float, source: string }
      deductible_min_kes: null,         // { value: float, source: string }
      policy_limit_kes: null            // { value: float, source: string }
    },
    audit: {
      is_blocked: false,
      block_reasons: [],
      warnings: []
    }
  };
}

module.exports = {
  VALID_SOURCES,
  VALID_HOUSING_CLASSES,
  VALID_COVER_SUBJECTS,
  tagged,
  createCanonicalRecord
};
