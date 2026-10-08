/**
 * Deterministic Fallback & Valuation Engine (Module 0)
 * Implements the locked intake rules from docs/INTAKE.md and docs/VALUATION.md
 */

const { tagged, createCanonicalRecord } = require('../schema/canonical');
const { INTEGRUM_2025_RATES, inferClassFromCost } = require('../data/integrumRates');
const { validateNairobiCoordinates } = require('../services/bounds');

/**
 * Resolves all raw inputs and applies deterministic fallbacks with source tagging
 * @param {Object} raw - Raw extracted object from RAG or regex parser
 * @param {Object} [options] - Additional parameters (e.g. demElevation, geocodedCoords)
 * @returns {Object} Complete Canonical Exposure Record
 */
function applyFallbacks(raw = {}, options = {}) {
  const record = createCanonicalRecord();
  const warnings = [];
  const blockReasons = [];

  record.property_name = raw.property_name || "Unnamed Property";
  record.reference = raw.reference || `PROP-${Date.now().toString().slice(-6)}`;

  // -------------------------------------------------------------
  // 1. SPATIAL INTAKE (lat, lon, elevation)
  // -------------------------------------------------------------
  let lat = raw.lat != null ? parseFloat(raw.lat) : null;
  let lon = raw.lon != null ? parseFloat(raw.lon) : null;
  let gpsSource = 'extracted';

  // Check geocoded fallback if raw GPS is missing
  if ((lat == null || lon == null) && options.geocodedCoords) {
    lat = parseFloat(options.geocodedCoords.lat);
    lon = parseFloat(options.geocodedCoords.lon);
    gpsSource = 'geocoded';
  } else if ((lat == null || lon == null) && options.humanCoords) {
    lat = parseFloat(options.humanCoords.lat);
    lon = parseFloat(options.humanCoords.lon);
    gpsSource = 'human';
  }

  if (lat != null && lon != null) {
    const bounds = validateNairobiCoordinates(lat, lon);
    if (!bounds.isValid) {
      blockReasons.push(bounds.error);
    } else {
      if (bounds.warning) warnings.push(bounds.warning);
      record.coordinates.lat = tagged(lat, gpsSource);
      record.coordinates.lon = tagged(lon, gpsSource);
    }
  } else {
    blockReasons.push("GPS coordinates missing. Underwriter must pinpoint property on map or provide address.");
  }

  // Elevation resolution
  let elevationDoc = raw.elevation_m != null ? parseFloat(raw.elevation_m) : null;
  let demElevation = options.demElevation != null ? parseFloat(options.demElevation) : null;

  if (elevationDoc != null) {
    record.coordinates.elevation_m = tagged(elevationDoc, 'extracted');
    if (demElevation != null) {
      if (Math.abs(elevationDoc - demElevation) > 5.0) {
        record.coordinates.elevation_m_dem = tagged(demElevation, 'dem');
        warnings.push(`Stated elevation (${elevationDoc}m) differs from Copernicus DEM (${demElevation}m) by > 5m. Retaining document elevation as primary.`);
      }
    }
  } else if (demElevation != null) {
    record.coordinates.elevation_m = tagged(demElevation, 'dem');
  } else {
    // Default regional elevation if neither exists
    record.coordinates.elevation_m = tagged(1600.0, 'class_default');
    warnings.push("Elevation not stated; defaulted to regional baseline 1,600m ASL.");
  }

  // -------------------------------------------------------------
  // 2. VALUATION RESOLUTION (TIV, GFA, cost_per_m2)
  // -------------------------------------------------------------
  let statedTiv = raw.tiv_kes != null ? parseFloat(raw.tiv_kes) : null;
  let statedArea = raw.floor_area_m2 != null ? parseFloat(raw.floor_area_m2) : null;
  let statedCost = raw.cost_per_m2_kes != null ? parseFloat(raw.cost_per_m2_kes) : null;

  // Resolve construction class first or infer it from rates
  let housingClass = raw.housing_class || null;
  let classSource = 'extracted';

  if (!housingClass) {
    if (statedTiv && statedArea) {
      const impliedRate = statedTiv / statedArea;
      housingClass = inferClassFromCost(impliedRate);
      classSource = 'implied';
      warnings.push(`Construction class inferred as "${housingClass}" from implied rate KES ${Math.round(impliedRate)}/m².`);
    } else if (statedCost) {
      housingClass = inferClassFromCost(statedCost);
      classSource = 'implied';
    } else {
      housingClass = 'permanent_masonry';
      classSource = 'class_default';
      warnings.push('Construction class unstated; defaulted to "permanent_masonry".');
    }
  }
  record.exposure.housing_class = tagged(housingClass, classSource);

  const classRef = INTEGRUM_2025_RATES[housingClass] || INTEGRUM_2025_RATES.permanent_masonry;

  // Resolve Area and Cost/m²
  if (statedArea != null && statedArea > 0) {
    record.exposure.floor_area_m2 = tagged(statedArea, 'extracted');
  } else if (statedTiv != null && statedCost != null) {
    statedArea = statedTiv / statedCost;
    record.exposure.floor_area_m2 = tagged(Math.round(statedArea * 10) / 10, 'implied');
  } else {
    statedArea = classRef.typical_area_m2;
    record.exposure.floor_area_m2 = tagged(statedArea, 'class_default');
    warnings.push(`Floor area not provided; assumed class typical ${statedArea} m².`);
  }

  // Resolve TIV (Declared TIV supremacy rule per docs/VALUATION.md)
  if (statedTiv != null && statedTiv > 0) {
    record.exposure.tiv_kes = tagged(statedTiv, 'extracted');
    const impliedRate = Math.round((statedTiv / statedArea) * 10) / 10;
    record.exposure.cost_per_m2_kes = tagged(impliedRate, 'implied');

    // Check against Integrum benchmark range
    if (impliedRate < classRef.min_cost_m2 * 0.7 || impliedRate > classRef.max_cost_m2 * 1.5) {
      warnings.push(`Implied rate KES ${impliedRate}/m² deviates from standard Integrum 2025 range [${classRef.min_cost_m2}, ${classRef.max_cost_m2}] for ${classRef.label}.`);
    }
  } else if (statedCost != null && statedArea != null) {
    statedTiv = Math.round(statedArea * statedCost);
    record.exposure.tiv_kes = tagged(statedTiv, 'implied');
    record.exposure.cost_per_m2_kes = tagged(statedCost, 'extracted');
  } else if (statedArea != null) {
    statedCost = classRef.median_cost_m2;
    statedTiv = Math.round(statedArea * statedCost);
    record.exposure.tiv_kes = tagged(statedTiv, 'implied');
    record.exposure.cost_per_m2_kes = tagged(statedCost, 'class_default');
    warnings.push(`TIV estimated as KES ${statedTiv.toLocaleString()} using Integrum median rate KES ${statedCost}/m².`);
  } else {
    blockReasons.push("Cannot value property: Neither TIV nor (Floor Area + Cost) could be determined.");
  }

  // -------------------------------------------------------------
  // 3. STRUCTURAL EXPOSURE (Floors, Height, Basements, Plant)
  // -------------------------------------------------------------
  let floors = raw.floors_above_ground != null ? parseInt(raw.floors_above_ground, 10) : null;
  if (floors != null && floors > 0) {
    record.exposure.floors_above_ground = tagged(floors, 'extracted');
  } else {
    floors = classRef.default_floors;
    record.exposure.floors_above_ground = tagged(floors, 'class_default');
  }

  // Total Height
  let height = raw.total_height_m != null ? parseFloat(raw.total_height_m) : null;
  if (height != null && height > 0) {
    record.exposure.total_height_m = tagged(height, 'extracted');
  } else {
    height = Math.round((floors * classRef.floor_height_m) * 10) / 10;
    record.exposure.total_height_m = tagged(height, 'implied');
  }

  // Basement Floors
  let basements = raw.basement_floors != null ? parseInt(raw.basement_floors, 10) : 0;
  record.exposure.basement_floors = tagged(basements, raw.basement_floors != null ? 'extracted' : 'class_default');

  // First Floor Plinth Clearance
  let plinth = raw.first_floor_height_m != null ? parseFloat(raw.first_floor_height_m) : classRef.default_plinth_m;
  record.exposure.first_floor_height_m = tagged(plinth, raw.first_floor_height_m != null ? 'extracted' : 'class_default');

  // Critical plant in basement flag
  let plantInBasement = raw.critical_plant_in_basement === true;
  record.exposure.critical_plant_in_basement = tagged(plantInBasement, raw.critical_plant_in_basement != null ? 'extracted' : 'implied');

  record.exposure.occupancy = tagged(raw.occupancy || (housingClass === 'concrete_rcc' ? 'commercial' : 'residential'), 'derived');

  // -------------------------------------------------------------
  // 4. COVERAGE & FINANCIAL TERMS (Policy Clauses)
  // -------------------------------------------------------------
  record.coverage.class_of_business = tagged(raw.class_of_business || "Commercial Property", raw.class_of_business ? 'extracted' : 'class_default');
  record.coverage.coverage_type = tagged(raw.coverage_type || "All-Risks (excluding flood)", raw.coverage_type ? 'extracted' : 'class_default');
  record.coverage.flood_cover_requested = tagged(raw.flood_cover_requested !== false, 'extracted');

  // Cover Subject Inference (docs/INTAKE.md rule)
  let subject = raw.cover_subject || null;
  if (!subject) {
    const covStr = (raw.coverage_type || "").toLowerCase();
    const classStr = (raw.class_of_business || "").toLowerCase();
    if (covStr.includes('building only') || classStr.includes('building only')) {
      subject = 'building';
    } else if (covStr.includes('contents') || covStr.includes('stock only')) {
      subject = 'assets';
    } else {
      subject = 'both'; // All-Risks commercial with single TIV bundles building and assets
    }
  }
  record.coverage.cover_subject = tagged(subject, 'derived');
  record.coverage.insured_interest = Array.isArray(raw.insured_interest) && raw.insured_interest.length > 0 
    ? raw.insured_interest 
    : ["owner/lessor", "occupying tenants"];

  // Deductibles & Policy Limits
  let dedPct = raw.deductible_pct != null ? parseFloat(raw.deductible_pct) : 0.05; // 5% default on commercial
  let dedMin = raw.deductible_min_kes != null ? parseFloat(raw.deductible_min_kes) : (record.exposure.housing_class.value === 'concrete_rcc' ? 5000000.0 : 0.0);
  let limit = raw.policy_limit_kes != null ? parseFloat(raw.policy_limit_kes) : statedTiv;

  record.financial_terms.deductible_pct = tagged(dedPct, raw.deductible_pct != null ? 'extracted' : 'class_default');
  record.financial_terms.deductible_min_kes = tagged(dedMin, raw.deductible_min_kes != null ? 'extracted' : 'class_default');
  record.financial_terms.policy_limit_kes = tagged(limit, raw.policy_limit_kes != null ? 'extracted' : 'class_default');

  // -------------------------------------------------------------
  // 5. AUDIT & BLOCKER EVALUATION
  // -------------------------------------------------------------
  record.audit.is_blocked = blockReasons.length > 0;
  record.audit.block_reasons = blockReasons;
  record.audit.warnings = warnings;

  return record;
}

module.exports = {
  applyFallbacks
};
