/**
 * Landmark Plaza expected parse — docs/INTAKE.md
 * Used when the intake API is offline so the cockpit is testable on day 1.
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

window.LANDMARK_PARSE = {
  property_name: "Landmark Plaza Commercial Development",
  reference: "EIB-NAI-LP-2026-001",
  coordinates: {
    lat: { value: -1.2847, source: "extracted" },
    lon: { value: 36.8247, source: "extracted" },
    elevation_m: { value: 1612.0, source: "extracted" },
  },
  exposure: {
    housing_class: { value: "concrete_rcc", source: "extracted" },
    occupancy: { value: "commercial", source: "derived" },
    floor_area_m2: { value: 24500.0, source: "extracted" },
    floors_above_ground: { value: 18, source: "extracted" },
    total_height_m: { value: 64.8, source: "extracted" },
    basement_floors: { value: 2, source: "extracted" },
    first_floor_height_m: { value: 1.0, source: "class_default" },
    critical_plant_in_basement: { value: true, source: "extracted" },
    tiv_kes: { value: 1090000000.0, source: "extracted" },
    cost_per_m2_kes: { value: 44489.8, source: "implied" },
  },
  coverage: {
    class_of_business: {
      value: "Commercial Property (Multi-Story Office & Retail)",
      source: "extracted",
    },
    coverage_type: {
      value: "All-Risks (excluding flood)",
      source: "extracted",
    },
    flood_cover_requested: { value: true, source: "extracted" },
    cover_subject: { value: "both", source: "derived" },
    insured_interest: ["owner/lessor", "occupying tenants"],
  },
  financial_terms: {
    deductible_pct: { value: 0.05, source: "extracted" },
    deductible_min_kes: { value: 5000000.0, source: "extracted" },
    policy_limit_kes: { value: 1090000000.0, source: "extracted" },
  },
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
  };
};
