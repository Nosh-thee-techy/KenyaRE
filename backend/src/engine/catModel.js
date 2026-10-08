/**
 * Kenya Re Nairobi Flood Catastrophe Modeling Engine
 * Modules 1-4: Hazard, Vulnerability (JRC Sigmoid + Wet-Storey Split), and Financial Engine.
 */

const fs = require('fs');
const path = require('path');

// JRC Huizinga Sigmoid parameters by housing class
const VULNERABILITY_CURVES = {
  informal_iron_sheet: { K: 0.90, S0: 0.30, k: 3.5, label: "Informal Mabati" },
  semi_permanent:      { K: 0.85, S0: 0.60, k: 2.8, label: "Semi-Permanent" },
  permanent_masonry:   { K: 0.75, S0: 1.00, k: 2.2, label: "Masonry Stone" },
  concrete_rcc:        { K: 0.65, S0: 1.50, k: 1.6, label: "Commercial RCC" }
};

// 5 Standard Return Periods (Inverted GeoTIFF mapping)
const RETURN_PERIODS = [
  { tier: "extreme",    rp: 10,  aep: 0.100, base_depth_m: 0.25 },
  { tier: "severe",     rp: 25,  aep: 0.040, base_depth_m: 0.55 },
  { tier: "moderate",   rp: 50,  aep: 0.020, base_depth_m: 0.95 },
  { tier: "occasional", rp: 100, aep: 0.010, base_depth_m: 1.45 },
  { tier: "common",     rp: 250, aep: 0.004, base_depth_m: 2.20 }
];

// Drainage hotspots subject to AI penalty (Kibera, Westlands, Upper Hill, Lavington, South C)
const DRAINAGE_HOTSPOTS = [
  { name: "Upper Hill / Community", lat: -1.2982, lon: 36.8085, radius_km: 2.5 },
  { name: "Westlands / Ojijo Rd",   lat: -1.2647, lon: 36.8044, radius_km: 2.0 },
  { name: "South C / Mombasa Rd",   lat: -1.3210, lon: 36.8320, radius_km: 2.0 },
  { name: "Kibera Drainage Line",   lat: -1.3140, lon: 36.7860, radius_km: 2.0 },
  { name: "Lavington Valley",       lat: -1.2780, lon: 36.7680, radius_km: 2.0 }
];

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates flood depths with AI Drainage Penalty check
 */
function evaluateHazard(lat, lon) {
  let aiPenalty = 0.0;
  let nearbyHotspot = null;

  if (lat != null && lon != null) {
    for (const spot of DRAINAGE_HOTSPOTS) {
      const dist = haversineKm(lat, lon, spot.lat, spot.lon);
      if (dist <= spot.radius_km) {
        aiPenalty = 0.35; // +0.35m AI stormwater drainage penalty
        nearbyHotspot = spot.name;
        break;
      }
    }
  }

  return {
    ai_penalty_m: aiPenalty,
    hotspot_flagged: nearbyHotspot,
    scenarios: RETURN_PERIODS.map(rp => ({
      tier: rp.tier,
      return_period: rp.rp,
      aep: rp.aep,
      flood_depth_m: Math.round((rp.base_depth_m + aiPenalty) * 100) / 100
    }))
  };
}

/**
 * JRC Sigmoid Damage Ratio
 */
function calculateDamageRatio(depthM, housingClass) {
  if (depthM <= 0) return 0;
  const curve = VULNERABILITY_CURVES[housingClass] || VULNERABILITY_CURVES.concrete_rcc;
  const dr = curve.K / (1 + Math.exp(-curve.k * (depthM - curve.S0)));
  return Math.min(Math.max(dr, 0), curve.K);
}

/**
 * Runs the full catastrophe model evaluation on a canonical exposure record
 */
function runCatModel(exposureRecord) {
  const lat = exposureRecord.coordinates?.lat?.value ?? exposureRecord.coordinates?.lat;
  const lon = exposureRecord.coordinates?.lon?.value ?? exposureRecord.coordinates?.lon;
  const housingClass = exposureRecord.exposure?.housing_class?.value || exposureRecord.exposure?.housing_class || 'concrete_rcc';
  const tiv = Number(exposureRecord.exposure?.tiv_kes?.value ?? exposureRecord.exposure?.tiv_kes ?? 1090000000);
  const gfa = Number(exposureRecord.exposure?.floor_area_m2?.value ?? exposureRecord.exposure?.floor_area_m2 ?? 24500);
  const floors = Number(exposureRecord.exposure?.floors_above_ground?.value ?? exposureRecord.exposure?.floors_above_ground ?? 18);
  const basements = Number(exposureRecord.exposure?.basement_floors?.value ?? exposureRecord.exposure?.basement_floors ?? 2);
  const hasBasementPlant = Boolean(exposureRecord.exposure?.critical_plant_in_basement?.value ?? exposureRecord.exposure?.critical_plant_in_basement);

  const dedPct = Number(exposureRecord.financial_terms?.deductible_pct?.value ?? exposureRecord.financial_terms?.deductible_pct ?? 0.05);
  const dedMin = Number(exposureRecord.financial_terms?.deductible_min_kes?.value ?? exposureRecord.financial_terms?.deductible_min_kes ?? 5000000);
  const policyLimit = Number(exposureRecord.financial_terms?.policy_limit_kes?.value ?? exposureRecord.financial_terms?.policy_limit_kes ?? tiv);

  // 1. Hazard Evaluation
  const hazard = evaluateHazard(lat, lon);

  // 2. Wet-Storey Tower Area Split
  const typicalFloorArea = floors > 0 ? (gfa / floors) : gfa;
  const costPerM2 = gfa > 0 ? (tiv / gfa) : 44490;

  // 3. Loss Calculation across Return Periods
  const epCurve = [];
  let aalGroundUp = 0;
  let aalNet = 0;

  hazard.scenarios.forEach((sc, idx) => {
    const dr = calculateDamageRatio(sc.flood_depth_m, housingClass);

    // Physical damage: Ground floor damage + Basement plant surcharge
    let groundUpLoss = 0;
    if (floors > 1) {
      // High-rise / multi-storey: damage strictly to ground floor plate
      groundUpLoss = dr * typicalFloorArea * costPerM2;
      // Add Basement Plant Surcharge if generators/chillers are in B1/B2
      if (hasBasementPlant && sc.flood_depth_m >= 0.20) {
        const plantSurcharge = 45000000; // KES 45M for commercial standby plant
        groundUpLoss += plantSurcharge;
      }
    } else {
      // Single storey: damage applies to full TIV
      groundUpLoss = dr * tiv;
    }

    groundUpLoss = Math.round(Math.min(groundUpLoss, tiv));

    // Financial policy terms: max(pct * loss, min KES)
    const deductibleAbsorbed = Math.min(Math.max(dedPct * groundUpLoss, dedMin), groundUpLoss);
    const netLoss = Math.round(Math.min(Math.max(groundUpLoss - deductibleAbsorbed, 0), policyLimit));

    epCurve.push({
      tier: sc.tier,
      return_period: sc.return_period,
      aep: sc.aep,
      flood_depth_m: sc.flood_depth_m,
      damage_ratio: Math.round(dr * 1000) / 1000,
      ground_up_loss_kes: groundUpLoss,
      deductible_kes: Math.round(deductibleAbsorbed),
      net_loss_kes: netLoss
    });
  });

  // Calculate AAL via trapezoidal integration of EP curve
  for (let i = 0; i < epCurve.length - 1; i++) {
    const p1 = epCurve[i].aep;
    const p2 = epCurve[i + 1].aep;
    const dP = Math.abs(p1 - p2);
    aalGroundUp += dP * ((epCurve[i].ground_up_loss_kes + epCurve[i + 1].ground_up_loss_kes) / 2);
    aalNet += dP * ((epCurve[i].net_loss_kes + epCurve[i + 1].net_loss_kes) / 2);
  }

  const pml100 = epCurve.find(p => p.return_period === 100) || epCurve[3];
  const pml250 = epCurve.find(p => p.return_period === 250) || epCurve[4];

  return {
    evaluated_at: new Date().toISOString(),
    hazard_summary: {
      ai_drainage_penalty_applied: hazard.ai_penalty_m > 0,
      nearby_hotspot: hazard.hotspot_flagged,
      penalty_m: hazard.ai_penalty_m
    },
    metrics: {
      aal_ground_up_kes: Math.round(aalGroundUp),
      aal_net_kes: Math.round(aalNet),
      pml_100y_kes: pml100.net_loss_kes,
      pml_250y_kes: pml250.net_loss_kes,
      rate_on_line_pct: Math.round((aalNet / tiv) * 10000) / 100
    },
    ep_curve: epCurve
  };
}

module.exports = {
  evaluateHazard,
  calculateDamageRatio,
  runCatModel,
  VULNERABILITY_CURVES,
  RETURN_PERIODS
};
