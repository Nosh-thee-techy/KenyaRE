const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AI_OSM = "0";
process.env.AI_EVIDENCE_GEMINI = "0";

const { haversineKm, gatePin, resetHotspotCache, loadHotspots } = require("../src/engine/hotspots");
const { fallbackRows } = require("../src/engine/evidencePack");
const { attachAiUpgrade, AI_SCORE_ADD } = require("../src/engine/aiUpgrade");
const { calculateDamageRatio, financialLoss, priceScenarios, summarizeMetrics } = require("../src/engine/catModel");

const KIBERA = { lat: -1.3113332, lon: 36.7890001 };
const LANDMARK = { lat: -1.2847, lon: 36.8247 };

function drySample() {
  return Promise.resolve({ status: "nodata", value: null });
}

function baseResult(lat, lon) {
  const scenarios = [2, 5, 10, 50, 100].map((rp, i) => {
    const aep = [0.5, 0.2, 0.1, 0.02, 0.01][i];
    const hmax = [0.5, 0.8, 1.2, 1.8, 2.2][i];
    return {
      tier: ["common", "occasional", "moderate", "severe", "extreme"][i],
      return_period: rp,
      aep,
      assumed_max_depth_m: hmax,
      susceptibility: 0,
      susceptibility_score: 0,
      flood_depth_m: 0,
      estimated_depth_m: 0,
      ground_up_loss_kes: 0,
      net_loss_kes: 0,
      status: "ok"
    };
  });
  return {
    success: true,
    model: { assumptions: ["base"], depth_method: "score × Hmax" },
    scenarios,
    ep_curve: scenarios,
    metrics: { aal_ground_up_kes: 0, aal_net_kes: 0, pml_100y_kes: 0 },
    base_loss_per_tier: scenarios.map((s) => ({ tier: s.tier, ground_up_loss_kes: 0, insured_loss_kes: 0 }))
  };
}

const priceInputs = {
  housingClass: "concrete_rcc",
  tiv: 100000000,
  gfa: 1000,
  floors: 2,
  basements: 0,
  plant: false,
  terms: { deductible_pct: { value: 0.05 }, deductible_min_kes: { value: 500000 }, policy_limit_kes: { value: 80000000 } }
};

test("24 geocoded hotspots load from the kit CSV", () => {
  const list = loadHotspots();
  assert.equal(list.length, 24);
  assert.ok(list.some((row) => row.name === "Kibera"));
});

test("Kibera pin sits inside the 2 km gate of itself", async () => {
  resetHotspotCache();
  const gate = await gatePin(KIBERA.lat, KIBERA.lon, drySample);
  assert.equal(gate.in_blind_radius, true);
  assert.equal(gate.nearest_blinded.name, "Kibera");
  assert.ok(gate.nearest_blinded.distance_km < 0.05);
});

test("Landmark Plaza is outside the Kibera drainage gate", async () => {
  resetHotspotCache();
  const km = haversineKm(LANDMARK.lat, LANDMARK.lon, KIBERA.lat, KIBERA.lon);
  assert.ok(km > 2);
  const gate = await gatePin(LANDMARK.lat, LANDMARK.lon, drySample);
  assert.equal(gate.in_blind_radius, false);
});

test("allowlist names drainage for kit-blinded suburbs only", () => {
  const kibera = fallbackRows("Kibera");
  assert.ok(kibera.some((row) => row.mechanism === "drainage" && row.quote));
  const kayole = fallbackRows("Kayole");
  assert.ok(kayole.every((row) => row.mechanism !== "drainage"));
});

test("AI upgrade raises AAL on a blinded Kibera pin", async () => {
  resetHotspotCache();
  const result = await attachAiUpgrade(baseResult(KIBERA.lat, KIBERA.lon), { ...priceInputs, ...KIBERA }, {
    sampleSusceptibility: drySample,
    priceScenarios,
    summarizeMetrics
  });
  assert.equal(result.ai_upgrade.applied, true);
  assert.equal(result.ai_upgrade.surcharge.value, AI_SCORE_ADD);
  assert.ok(result.ai_metrics.aal_ground_up_kes > result.metrics.aal_ground_up_kes);
  assert.ok(result.ai_ep_curve[4].flood_depth_m > 0);
  assert.equal(result.ep_curve[4].flood_depth_m, 0);
  assert.ok(result.ai_upgrade.sources.length >= 4);
  assert.ok(result.ai_upgrade.assumptions.length >= 5);
});

test("AI upgrade does not invent a TIFF change on a dry CBD pin", async () => {
  resetHotspotCache();
  const result = await attachAiUpgrade(baseResult(LANDMARK.lat, LANDMARK.lon), { ...priceInputs, ...LANDMARK }, {
    sampleSusceptibility: drySample,
    priceScenarios,
    summarizeMetrics
  });
  assert.equal(result.ai_upgrade.applied, false);
  assert.equal(result.ai_metrics.aal_ground_up_kes, result.metrics.aal_ground_up_kes);
});

test("JRC still ranks informal above RCC at the same depth", () => {
  assert.ok(calculateDamageRatio(1.2, "informal_iron_sheet") > calculateDamageRatio(1.2, "concrete_rcc"));
  assert.equal(financialLoss(10000000, {}).status, "not_configured");
});
