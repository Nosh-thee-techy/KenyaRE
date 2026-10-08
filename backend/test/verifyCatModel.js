/**
 * Kenya Re CatNet - Catastrophe Model & Database Retrieval Verification Test
 */

const assert = require('assert');
const { runCatModel, evaluateHazard } = require('../src/engine/catModel');
const { saveExposure, getExposure } = require('../src/services/firestore.service');

const landmarkExposure = {
  property_name: "Landmark Plaza Commercial Development",
  reference: "EIB-NAI-LP-2026-001",
  coordinates: {
    lat: { value: -1.2847, source: "extracted" },
    lon: { value: 36.8247, source: "extracted" },
    elevation_m: { value: 1612, source: "extracted" }
  },
  exposure: {
    housing_class: { value: "concrete_rcc", source: "extracted" },
    occupancy: { value: "commercial", source: "derived" },
    floor_area_m2: { value: 24500, source: "extracted" },
    floors_above_ground: { value: 18, source: "extracted" },
    total_height_m: { value: 64.8, source: "extracted" },
    basement_floors: { value: 2, source: "extracted" },
    critical_plant_in_basement: { value: true, source: "extracted" },
    tiv_kes: { value: 1090000000, source: "extracted" }
  },
  coverage: {
    coverage_type: { value: "All-Risks (excluding flood)", source: "extracted" },
    cover_subject: { value: "both", source: "derived" }
  },
  financial_terms: {
    deductible_pct: { value: 0.05, source: "extracted" },
    deductible_min_kes: { value: 5000000, source: "extracted" },
    policy_limit_kes: { value: 1090000000, source: "extracted" }
  }
};

async function runTests() {
  console.log("\n==================================================================");
  console.log("   KENYA RE FLOOD CATNET - ENGINE & DATABASE RETRIEVAL SUITE      ");
  console.log("==================================================================\n");

  let passed = 0;
  let total = 0;
  function check(desc, cond) {
    total++;
    if (cond) {
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
    }
  }

  // 1. Hazard Evaluation
  console.log("[TEST 1] Evaluating Nairobi Hazard with AI Drainage Surcharge...");
  const hazard = evaluateHazard(-1.2847, 36.8247);
  check("Hazard returns 5 return period scenarios", hazard.scenarios.length === 5);
  check("10y depth is lower than 250y depth", hazard.scenarios[0].flood_depth_m < hazard.scenarios[4].flood_depth_m);

  // 2. Cat Model Execution
  console.log("\n[TEST 2] Running Cat Model on Landmark Plaza (Wet-Storey Split)...");
  const modelRes = runCatModel(landmarkExposure);
  check("EP curve contains 5 scenarios", modelRes.ep_curve.length === 5);
  
  const ep = modelRes.ep_curve;
  check("Loss monotonicity: 250Y loss > 10Y loss", ep[4].ground_up_loss_kes > ep[0].ground_up_loss_kes);
  check("Tower Wet-Storey Split: 100Y loss does NOT exceed full tower (KES 1.09B)", ep[3].ground_up_loss_kes < 300000000);
  check("AAL Ground-up is positive", modelRes.metrics.aal_ground_up_kes > 0);
  check("PML 100Y Net Loss is calculated", modelRes.metrics.pml_100y_kes > 0);
  check("PML 250Y Net Loss is higher than PML 100Y", modelRes.metrics.pml_250y_kes >= modelRes.metrics.pml_100y_kes);

  // 3. Database Persistence & Retrieval
  console.log("\n[TEST 3] Persisting Model Run to Firestore and Retrieving...");
  const recordToSave = {
    ...landmarkExposure,
    model_results: modelRes
  };
  const saveResult = await saveExposure(recordToSave);
  check("Record saved successfully to DB", saveResult.success === true);

  const retrieved = await getExposure("EIB-NAI-LP-2026-001");
  check("Retrieved record exists in DB", retrieved !== null);
  check("Retrieved record contains model_results", retrieved.model_results != null);
  check("Retrieved PML 100Y matches computed value", retrieved.model_results.metrics.pml_100y_kes === modelRes.metrics.pml_100y_kes);

  console.log("\n==================================================================");
  console.log(`   RESULTS: ${passed} / ${total} CHECKS PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log("==================================================================\n");

  if (passed === total) {
    console.log("🎉 ALL CAT MODEL & DATABASE RETRIEVAL CHECKS PASSED!\n");
  } else {
    process.exitCode = 1;
  }
}

runTests();
