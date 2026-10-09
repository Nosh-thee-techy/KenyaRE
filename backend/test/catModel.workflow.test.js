const test = require("node:test");
const assert = require("node:assert/strict");
const {
  runCatModel,
  sampleSusceptibility,
  calculateDamageRatio,
  financialLoss
} = require("../src/engine/catModel");

const exposure = {
  property_name: "Test property",
  reference: "TEST-1",
  coordinates: { lat: { value: -1.2847 }, lon: { value: 36.8247 } },
  exposure: {
    housing_class: { value: "concrete_rcc" },
    floor_area_m2: { value: 1000 },
    floors_above_ground: { value: 2 },
    tiv_kes: { value: 100000000 }
  },
  financial_terms: {
    deductible_pct: { value: 0.05 },
    deductible_min_kes: { value: 5000000 },
    policy_limit_kes: { value: 80000000 }
  }
};

test("samples georeferenced susceptibility and caches the result", async () => {
  const first = await sampleSusceptibility("common", -1.2847, 36.8247);
  const second = await sampleSusceptibility("common", -1.2847, 36.8247);
  assert.equal(first.status, "ok");
  assert.equal(first, second);
  assert.ok(first.value >= 0 && first.value <= 1);
});

test("maps proxy susceptibility to an explanatory depth and preserves curve ordering", async () => {
  const result = await runCatModel(exposure);
  assert.deepEqual(result.scenarios.map((s) => s.tier), ["common", "occasional", "moderate", "severe", "extreme"]);
  assert.deepEqual(result.scenarios.map((s) => s.return_period), [2, 5, 10, 50, 100]);
  assert.ok(result.scenarios.every((s) => s.depth_method.includes("not measured depth")));
  assert.ok(calculateDamageRatio(2, "informal_iron_sheet") > calculateDamageRatio(2, "concrete_rcc"));
});

test("does not fabricate financial values and applies deductible and limit", () => {
  assert.equal(financialLoss(10000000, {}).status, "not_configured");
  assert.deepEqual(financialLoss(100000000, {
    deductible_pct: { value: 0.05 },
    deductible_min_kes: { value: 5000000 },
    policy_limit_kes: { value: 80000000 }
  }), {
    status: "ok",
    deductible_kes: 5000000,
    loss_after_deductible_kes: 95000000,
    net_loss_kes: 80000000
  });
});

test("returns structured errors for incomplete exposure", async () => {
  const result = await runCatModel({ coordinates: { lat: 0, lon: 0 } });
  assert.equal(result.success, false);
  assert.ok(result.errors.some((error) => error.code === "MISSING_TIV"));
  assert.ok(result.scenarios.every((scenario) => scenario.status === "out_of_bounds" || scenario.status === "invalid_exposure"));
});

test("returns the contract response fields and compact loss summaries", async () => {
  const result = await runCatModel(exposure);
  assert.equal(result.model.peril, "Nairobi urban pluvial flood");
  assert.equal(result.model.depth_estimates_are_explanatory, true);
  assert.equal(result.model.depths_are_hydraulically_validated, false);
  assert.ok(result.model.assumptions.length > 0);
  assert.equal(result.loss_curve.x_axis, "insured_loss_kes");
  assert.equal(result.loss_curve.y_axis, "annual_exceedance_probability");
  assert.equal(result.loss_curve.points.length, 5);
  assert.ok(Array.isArray(result.base_loss_per_tier));
  const scenario = result.scenarios[0];
  assert.ok("damage_ratio" in scenario.damage);
  assert.ok("damage_percentage" in scenario.damage);
  assert.ok("gross_damage_kes" in scenario.loss);
  assert.ok("insured_loss_kes" in scenario.loss);
  assert.ok(Array.isArray(scenario.warnings));
});

test("audit blocking and invalid coordinate ranges prevent a successful run", async () => {
  const result = await runCatModel({
    ...exposure,
    coordinates: { lat: { value: 91 }, lon: { value: 36 } },
    audit: { is_blocked: true }
  });
  assert.equal(result.success, false);
  assert.ok(result.errors.some((error) => error.code === "INVALID_COORDINATES"));
  assert.ok(result.errors.some((error) => error.code === "AUDIT_BLOCKED"));
});
