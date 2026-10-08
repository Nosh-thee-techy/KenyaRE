/**
 * Shared intake constants: Nairobi raster bounds, Integrum cost bands,
 * and the empty parse factory. No fixture risk is preloaded.
 */
window.NAIROBI_RASTER = {
  latMin: -1.45,
  latMax: -1.1,
  lonMin: 36.6,
  lonMax: 37.0,
  center: [-1.286, 36.82],
};

window.CLASS_COST_BANDS = {
  informal_iron_sheet: { min: 5000, max: 10000, label: "informal / mabati" },
  semi_permanent: { min: 8000, max: 16000, label: "semi-permanent" },
  permanent_masonry: { min: 35300, max: 64700, label: "masonry bungalow" },
  concrete_rcc: { min: 35000, max: 85000, label: "commercial RCC" },
};

window.emptyParse = function emptyParse() {
  return {
    property_name: { value: "", source: "human" },
    reference: { value: "", source: "human" },
    coordinates: {
      lat: { value: null, source: null },
      lon: { value: null, source: null },
      elevation_m: { value: null, source: null },
    },
    exposure: {
      housing_class: { value: "", source: null },
      occupancy: { value: "", source: null },
      floor_area_m2: { value: null, source: null },
      floors_above_ground: { value: null, source: null },
      total_height_m: { value: null, source: null },
      basement_floors: { value: null, source: null },
      first_floor_height_m: { value: null, source: null },
      critical_plant_in_basement: { value: false, source: null },
      tiv_kes: { value: null, source: null },
      cost_per_m2_kes: { value: null, source: null },
    },
    coverage: {
      class_of_business: { value: "", source: null },
      coverage_type: { value: "", source: null },
      cover_subject: { value: "", source: null },
    },
    financial_terms: {
      deductible_pct: { value: null, source: null },
      deductible_min_kes: { value: null, source: null },
      policy_limit_kes: { value: null, source: null },
    },
    audit: {
      is_blocked: false,
      block_reasons: [],
      warnings: [],
    },
  };
};
