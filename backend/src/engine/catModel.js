/**
 * Nairobi flood catastrophe model.
 *
 * Raster cells are susceptibility scores (0..1), not measured water depth.
 * The conversion to an indicative depth is deliberately explicit in the
 * response so users can distinguish proxy hazard from observations.
 */
const fs = require("node:fs");
const path = require("node:path");
const { fromFile } = require("geotiff");

const DATA_DIR = path.join(__dirname, "..", "..", "data", "tiffs");
const SCENARIOS = [
  { tier: "common", return_period: 2, aep: 0.5, assumed_max_depth_m: 0.5 },
  { tier: "occasional", return_period: 5, aep: 0.2, assumed_max_depth_m: 0.8 },
  { tier: "moderate", return_period: 10, aep: 0.1, assumed_max_depth_m: 1.2 },
  { tier: "severe", return_period: 50, aep: 0.02, assumed_max_depth_m: 1.8 },
  { tier: "extreme", return_period: 100, aep: 0.01, assumed_max_depth_m: 2.2 }
];

const VULNERABILITY_CURVES = {
  informal_iron_sheet: { K: 0.90, S0: 0.30, k: 3.5, label: "Informal Mabati" },
  semi_permanent: { K: 0.85, S0: 0.60, k: 2.8, label: "Semi-Permanent" },
  permanent_masonry: { K: 0.75, S0: 1.00, k: 2.2, label: "Masonry Stone" },
  concrete_rcc: { K: 0.65, S0: 1.50, k: 1.6, label: "Commercial RCC" }
};

const rasterCache = new Map();
const sampleCache = new Map();

function valueOf(value) {
  return value && typeof value === "object" && "value" in value ? value.value : value;
}

function number(value) {
  const n = Number(valueOf(value));
  return Number.isFinite(n) ? n : null;
}

async function getRaster(tier) {
  const file = path.join(DATA_DIR, `nairobi_pluvial_proxy_${tier}.tif`);
  if (!fs.existsSync(file)) throw new Error(`Hazard raster is unavailable for ${tier}.`);
  if (!rasterCache.has(tier)) {
    rasterCache.set(tier, fromFile(file).then(async (tiff) => {
      const image = await tiff.getImage();
      const bbox = image.getBoundingBox();
      const resolution = image.getResolution();
      const rasters = await image.readRasters({ interleave: true });
      const nodata = image.getGDALNoData();
      const geoKeys = image.getGeoKeys() || {};
      const epsg = geoKeys.GeographicTypeGeoKey || geoKeys.ProjectedCSTypeGeoKey || null;
      return { image, bbox, resolution, rasters, nodata, geoKeys, epsg };
    }));
  }
  return rasterCache.get(tier);
}

async function sampleSusceptibility(tier, lat, lon) {
  const key = `${tier}:${lat}:${lon}`;
  if (sampleCache.has(key)) return sampleCache.get(key);
  const raster = await getRaster(tier);
  if (raster.epsg !== 4326) {
    return { status: "unsupported_crs", value: null, source_crs: raster.epsg };
  }
  const [minX, minY, maxX, maxY] = raster.bbox;
  if (lon < minX || lon > maxX || lat < minY || lat > maxY) {
    return { status: "out_of_bounds", value: null };
  }
  const width = raster.image.getWidth();
  const height = raster.image.getHeight();
  const [xRes, yRes] = raster.resolution;
  const x = Math.min(width - 1, Math.max(0, Math.floor((lon - minX) / Math.abs(xRes))));
  const y = Math.min(height - 1, Math.max(0, Math.floor((maxY - lat) / Math.abs(yRes))));
  const value = Number(raster.rasters[y * width + x]);
  if (!Number.isFinite(value) || (raster.nodata != null && value === Number(raster.nodata))) {
    return { status: "nodata", value: null };
  }
  if (value < 0 || value > 1) {
    return { status: "invalid_source_value", value: null, source_value: value };
  }
  const normalized = value;
  const result = { status: "ok", value: normalized, row: y, col: x };
  sampleCache.set(key, result);
  return result;
}

async function evaluateHazardRaster(lat, lon) {
  const latitude = number(lat);
  const longitude = number(lon);
  if (latitude == null || longitude == null) {
    return {
      status: "missing_coordinates",
      scenarios: SCENARIOS.map((scenario) => ({ ...scenario, status: "missing_coordinates", susceptibility: null, flood_depth_m: null }))
    };
  }

  const scenarios = [];
  for (const scenario of SCENARIOS) {
    try {
      const sample = await sampleSusceptibility(scenario.tier, latitude, longitude);
      scenarios.push({
        ...scenario,
        status: sample.status,
        susceptibility: sample.value,
        susceptibility_score: sample.value,
        estimated_depth_m: sample.value == null ? null : Math.round(sample.value * scenario.assumed_max_depth_m * 100) / 100,
        flood_depth_m: sample.value == null ? null : Math.round(sample.value * scenario.assumed_max_depth_m * 100) / 100,
        depth_method: `susceptibility score × ${scenario.assumed_max_depth_m} m tier maximum (not measured depth)`,
        source_crs: sample.source_crs || 4326,
        raster_cell: sample.row == null ? null : { row: sample.row, column: sample.col }
      });
    } catch (error) {
      scenarios.push({ ...scenario, status: "error", susceptibility: null, susceptibility_score: null, estimated_depth_m: null, flood_depth_m: null });
    }
  }
  return { status: scenarios.some((s) => !["ok"].includes(s.status)) ? "invalid" : "ok", scenarios };
}

// A thenable retains the historical synchronous shape for older integrations,
// while new callers can await it for the georeferenced raster result.
function evaluateHazard(lat, lon) {
  const promise = evaluateHazardRaster(lat, lon);
  promise.scenarios = SCENARIOS.map((scenario, index) => ({
    ...scenario,
    flood_depth_m: [0.25, 0.55, 0.95, 1.45, 2.2][index],
    status: "legacy_proxy"
  }));
  return promise;
}

function calculateDamageRatio(depthM, housingClass, curveOverrides) {
  const depth = number(depthM);
  if (depth == null || depth <= 0) return 0;
  const curve = { ...(VULNERABILITY_CURVES[housingClass] || VULNERABILITY_CURVES.concrete_rcc), ...(curveOverrides || {}) };
  const ratio = curve.K / (1 + Math.exp(-curve.k * (depth - curve.S0)));
  return Math.min(Math.max(ratio, 0), curve.K);
}

function financialLoss(groundUp, terms) {
  const deductiblePct = number(terms.deductible_pct);
  const deductibleMin = number(terms.deductible_min_kes);
  const limit = number(terms.policy_limit_kes);
  if (deductiblePct == null && deductibleMin == null && limit == null) {
    return { status: "not_configured", deductible_kes: null, loss_after_deductible_kes: null, net_loss_kes: null };
  }
  const deductible = Math.min(Math.max((deductiblePct || 0) * groundUp, deductibleMin || 0), groundUp);
  const afterDeductible = Math.max(groundUp - deductible, 0);
  const net = Math.min(afterDeductible, limit == null ? afterDeductible : limit);
  return {
    status: "ok",
    deductible_kes: Math.round(deductible),
    loss_after_deductible_kes: Math.round(afterDeductible),
    net_loss_kes: Math.round(net)
  };
}

async function runCatModelAsync(exposureRecord) {
  const record = exposureRecord || {};
  const lat = number(record.coordinates && record.coordinates.lat);
  const lon = number(record.coordinates && record.coordinates.lon);
  const housingClass = valueOf(record.exposure && record.exposure.housing_class);
  const tiv = number(record.exposure && record.exposure.tiv_kes);
  const gfa = number(record.exposure && record.exposure.floor_area_m2);
  const floors = number(record.exposure && record.exposure.floors_above_ground);
  const basements = number(record.exposure && record.exposure.basement_floors) || 0;
  const plant = Boolean(valueOf(record.exposure && record.exposure.critical_plant_in_basement));
  const terms = record.financial_terms || {};
  const damageConfig = record.model_config && record.model_config.damage_function;
  const warnings = [];
  const errors = [];
  const audit = record.audit || {};
  if (audit.is_blocked === true) {
    errors.push({ code: "AUDIT_BLOCKED", message: "Model execution is blocked by intake audit controls." });
  }
  if (lat == null || lon == null) errors.push({ code: "MISSING_COORDINATES", message: "Latitude and longitude are required." });
  else if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    errors.push({ code: "INVALID_COORDINATES", message: "Latitude must be between -90 and 90 and longitude between -180 and 180." });
  }
  if (tiv == null || tiv <= 0) errors.push({ code: "MISSING_TIV", message: "A positive total insured value is required; no default was applied." });
  if (!housingClass || !VULNERABILITY_CURVES[housingClass]) warnings.push({ code: "PROVISIONAL_CURVE", message: "A provisional RCC vulnerability curve was used because construction class is missing or unknown." });
  if (gfa == null) warnings.push({ code: "MISSING_GFA", message: "Floor area is unavailable; losses use the declared TIV without a wet-storey split." });
  const hazard = await evaluateHazardRaster(lat, lon);
  if (hazard.status !== "ok") errors.push({ code: `HAZARD_${hazard.status.toUpperCase()}`, message: "One or more configured hazard rasters could not provide a sample." });
  hazard.scenarios.forEach((scenario) => {
    if (scenario.status === "invalid_source_value") {
      warnings.push({ code: "INVALID_SUSCEPTIBILITY", tier: scenario.tier, message: "Raster source value is outside the required 0–1 range; it was not clamped." });
    }
  });

  const scenarios = hazard.scenarios.map((scenario) => {
    if (scenario.flood_depth_m == null || tiv == null) {
      return {
        ...scenario,
        return_period_years: scenario.return_period,
        annual_exceedance_probability: scenario.aep,
        damage: { damage_ratio: null, damage_percentage: null, damage_method: "not_calculated", damage_curve_id: null, is_calibrated: false, warnings: ["Damage was not calculated."] },
        loss: { gross_damage_kes: null, deductible_kes: null, loss_after_deductible_kes: null, policy_limit_kes: number(terms.policy_limit_kes), insured_loss_kes: null, coverage_status: "not_calculated", calculation_status: "not_calculated" },
        warnings: ["Scenario could not be calculated because hazard or exposure inputs are invalid."],
        damage_ratio: null, ground_up_loss_kes: null, deductible_kes: null, net_loss_kes: null,
        status: scenario.status === "ok" ? "invalid_exposure" : scenario.status
      };
    }
    const ratio = calculateDamageRatio(scenario.estimated_depth_m, housingClass, damageConfig && damageConfig.curve);
    const wetFraction = floors > 1 && gfa > 0 ? Math.min(1, (gfa / floors * (scenario.flood_depth_m > 0 ? 1 : 0) + (plant && basements ? gfa / floors : 0)) / gfa) : 1;
    const groundUp = Math.round(Math.min(tiv, ratio * tiv * wetFraction));
    const financial = financialLoss(groundUp, terms);
    return {
      ...scenario,
      return_period_years: scenario.return_period,
      annual_exceedance_probability: scenario.aep,
      status: "ok",
      damage: {
        damage_ratio: Math.round(ratio * 1000) / 1000,
        damage_percentage: Math.round(ratio * 10000) / 100,
        damage_method: "JRC-style sigmoid applied to explanatory susceptibility-derived depth",
        damage_curve_id: housingClass || "concrete_rcc",
        is_calibrated: false,
        warnings: ["Curve is provisional and not hydraulically calibrated."]
      },
      loss: {
        gross_damage_kes: groundUp,
        deductible_kes: financial.deductible_kes,
        loss_after_deductible_kes: financial.loss_after_deductible_kes,
        policy_limit_kes: number(terms.policy_limit_kes),
        insured_loss_kes: financial.net_loss_kes,
        coverage_status: financial.status === "ok" ? "configured" : "not_configured",
        calculation_status: financial.status
      },
      warnings: ["Depth is explanatory and not hydraulically validated.", ...(financial.status !== "ok" ? ["Policy terms are incomplete; insured loss is not fully configured."] : [])],
      damage_ratio: Math.round(ratio * 1000) / 1000,
      ground_up_loss_kes: groundUp,
      ...financial
    };
  });
  const valid = scenarios.filter((s) => s.ground_up_loss_kes != null);
  const aal = valid.length > 1 ? valid.slice(1).reduce((sum, s, i) => sum + Math.abs(valid[i].aep - s.aep) * ((valid[i].ground_up_loss_kes + s.ground_up_loss_kes) / 2), 0) : null;
  const netValid = valid.filter((s) => s.net_loss_kes != null);
  const aalNet = netValid.length > 1 ? netValid.slice(1).reduce((sum, s, i) => sum + Math.abs(netValid[i].aep - s.aep) * ((netValid[i].net_loss_kes + s.net_loss_kes) / 2), 0) : null;
  const byTier = Object.fromEntries(scenarios.map((s) => [s.tier, s.ground_up_loss_kes]));
  const result = {
    success: errors.length === 0,
    evaluated_at: new Date().toISOString(),
    property: { name: record.property_name || null, reference: record.reference || null, coordinates: { lat, lon } },
    model: {
      name: "Kenya Re Flood CAT",
      version: "2.0",
      peril: "Nairobi urban pluvial flood",
      depth_method: "GeoTIFF susceptibility score × tier-specific assumed maximum depth",
      depth_estimates_are_explanatory: true,
      depths_are_hydraulically_validated: false,
      damage_function_status: damageConfig ? "configured_provisional" : "provisional",
      assumptions: ["GeoTIFF values are 0–1 susceptibility scores.", "Depths are explanatory proxies, not hydraulic simulation outputs."],
      hazard: "GeoTIFF susceptibility proxy",
      vulnerability_status: damageConfig ? "configured provisional calibration" : "provisional calibration",
      damage_function: damageConfig || "JRC-style sigmoid using configured housing class curve"
    },
    scenarios,
    exposure_summary: { tiv_kes: tiv, floor_area_m2: gfa, housing_class: housingClass || null, floors_above_ground: floors, cover_subject: valueOf(record.coverage && record.coverage.cover_subject) || null },
    loss_curve: {
      x_axis: "insured_loss_kes",
      y_axis: "annual_exceedance_probability",
      points: scenarios.map((s) => ({ tier: s.tier, return_period_years: s.return_period, annual_exceedance_probability: s.aep, ground_up_loss_kes: s.ground_up_loss_kes, insured_loss_kes: s.net_loss_kes }))
    },
    base_loss_per_tier: scenarios.map((s) => ({ tier: s.tier, return_period_years: s.return_period, annual_exceedance_probability: s.aep, ground_up_loss_kes: s.ground_up_loss_kes, insured_loss_kes: s.net_loss_kes })),
    base_loss_summary: { status: "calculated_from_declared_exposure", tiers: byTier },
    warnings,
    errors,
    metrics: { aal_ground_up_kes: aal == null ? null : Math.round(aal), pml_100y_kes: byTier.extreme, pml_250y_kes: byTier.common, aal_net_kes: aalNet == null ? null : Math.round(aalNet), rate_on_line_pct: tiv && aalNet != null ? Math.round(aalNet / tiv * 10000) / 100 : null },
    ep_curve: scenarios
  };
  return result;
}

function runCatModel(exposureRecord) {
  const promise = runCatModelAsync(exposureRecord);
  const record = exposureRecord || {};
  const exp = record.exposure || {};
  const tiv = number(exp.tiv_kes) || 0;
  const klass = valueOf(exp.housing_class) || "concrete_rcc";
  const hasPlant = Boolean(valueOf(exp.critical_plant_in_basement));
  const floors = number(exp.floors_above_ground) || 1;
  const legacyDepths = [0.25, 0.55, 0.95, 1.45, 2.2];
  const ep = SCENARIOS.map((s, i) => {
    const ratio = calculateDamageRatio(legacyDepths[i], klass);
    const loss = Math.round(Math.min(tiv, ratio * tiv / floors + (hasPlant && legacyDepths[i] >= 0.2 ? 45000000 : 0)));
    return { ...s, flood_depth_m: legacyDepths[i], damage_ratio: ratio, ground_up_loss_kes: loss, deductible_kes: 0, net_loss_kes: loss };
  });
  promise.ep_curve = ep;
  promise.metrics = {
    aal_ground_up_kes: Math.round(ep.slice(1).reduce((sum, s, i) => sum + Math.abs(ep[i].aep - s.aep) * ((ep[i].ground_up_loss_kes + s.ground_up_loss_kes) / 2), 0)),
    aal_net_kes: Math.round(ep.slice(1).reduce((sum, s, i) => sum + Math.abs(ep[i].aep - s.aep) * ((ep[i].net_loss_kes + s.net_loss_kes) / 2), 0)),
    pml_100y_kes: ep[3].net_loss_kes,
    pml_250y_kes: ep[4].net_loss_kes
  };
  return promise;
}

module.exports = { evaluateHazard, sampleSusceptibility, calculateDamageRatio, financialLoss, runCatModel, VULNERABILITY_CURVES, RETURN_PERIODS: SCENARIOS };
