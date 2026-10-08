/**
 * Automated Verification Test for Module 0 (Input Layer)
 * Validates Landmark Plaza against docs/INTAKE.md and verifies all fallback paths.
 */

const fs = require('fs');
const path = require('path');
const { processBrokerSlip } = require('../src/intake/orchestrator');

async function runTests() {
  console.log("==================================================================");
  console.log("   KENYA RE FLOOD CATNET - MODULE 0 INTAKE VERIFICATION SUITE    ");
  console.log("==================================================================\n");

  let totalPassed = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      totalPassed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
    }
  }

  // -------------------------------------------------------------
  // TEST 1: Gold Sample - Landmark Plaza Broker Memorandum
  // -------------------------------------------------------------
  console.log("[TEST 1] Verifying Landmark Plaza Ingestion vs docs/INTAKE.md fixture...");
  const slipPath = path.join(__dirname, '../data/sample_placement_slip.txt');
  const slipText = fs.readFileSync(slipPath, 'utf-8');

  const landmark = await processBrokerSlip(slipText);

  assert(landmark.property_name.includes("Landmark Plaza"), "Property Name extracted");
  assert(landmark.coordinates.lat.value === -1.2847, "Latitude = -1.2847");
  assert(landmark.coordinates.lat.source === "extracted", "Latitude source = extracted");
  assert(landmark.coordinates.lon.value === 36.8247, "Longitude = 36.8247");
  assert(landmark.coordinates.lon.source === "extracted", "Longitude source = extracted");
  assert(landmark.coordinates.elevation_m.value === 1612.0, "Elevation = 1612m");
  assert(landmark.coordinates.elevation_m.source === "extracted", "Elevation source = extracted");

  assert(landmark.exposure.housing_class.value === "concrete_rcc", "Housing Class = concrete_rcc");
  assert(landmark.exposure.housing_class.source === "extracted", "Housing Class source = extracted");
  assert(landmark.exposure.floors_above_ground.value === 18, "Floors above ground = 18");
  assert(landmark.exposure.basement_floors.value === 2, "Basement floors = 2");
  assert(landmark.exposure.total_height_m.value === 64.8, "Building height = 64.8m");
  assert(landmark.exposure.floor_area_m2.value === 24500.0, "Floor area GFA = 24,500 m²");
  assert(landmark.exposure.tiv_kes.value === 1090000000.0, "TIV = KES 1,090,000,000");
  assert(landmark.exposure.critical_plant_in_basement.value === true, "Critical plant in basement = true");
  assert(landmark.exposure.cost_per_m2_kes.value === 44489.8, "Implied rebuild rate = KES 44,489.8/m²");
  assert(landmark.exposure.cost_per_m2_kes.source === "implied", "Rebuild rate source = implied");

  assert(landmark.coverage.cover_subject.value === "both", "Coverage subject = both (bundled)");
  assert(landmark.financial_terms.deductible_pct.value === 0.05, "Deductible = 5%");
  assert(landmark.financial_terms.deductible_min_kes.value === 5000000.0, "Deductible min = KES 5,000,000");
  assert(landmark.financial_terms.policy_limit_kes.value === 1090000000.0, "Policy limit = KES 1,090,000,000");
  assert(landmark.audit.is_blocked === false, "Landmark audit is_blocked = false (ready to model)");

  // -------------------------------------------------------------
  // TEST 2: Fallback - Height Implied from Storey Count
  // -------------------------------------------------------------
  console.log("\n[TEST 2] Verifying Height Fallback when height is unstated...");
  const missingHeightInput = {
    property_name: "Test Heights",
    lat: -1.290,
    lon: 36.820,
    housing_class: "permanent_masonry",
    floors_above_ground: 3,
    tiv_kes: 15000000
  };
  const heightResult = await processBrokerSlip(missingHeightInput);
  assert(heightResult.exposure.total_height_m.value === 10.5, "Height implied: 3 floors * 3.5m = 10.5m");
  assert(heightResult.exposure.total_height_m.source === "implied", "Height source tagged as implied");

  // -------------------------------------------------------------
  // TEST 3: Fallback - Class Inferred from Implied KES/m² Rate
  // -------------------------------------------------------------
  console.log("\n[TEST 3] Verifying Construction Class Inference from implied rate...");
  const missingClassInput = {
    property_name: "Mystery Warehouse",
    lat: -1.300,
    lon: 36.850,
    floor_area_m2: 1000,
    tiv_kes: 75000000 // 75,000 KES/m² -> >60k => concrete_rcc
  };
  const classResult = await processBrokerSlip(missingClassInput);
  assert(classResult.exposure.housing_class.value === "concrete_rcc", "Class inferred as concrete_rcc (rate > 60k)");
  assert(classResult.exposure.housing_class.source === "implied", "Class source tagged as implied");

  // -------------------------------------------------------------
  // TEST 4: Blocker Guardrail - GPS Missing Must Block Run
  // -------------------------------------------------------------
  console.log("\n[TEST 4] Verifying Blocker Guardrail when GPS is missing...");
  const noGpsInput = {
    property_name: "Ghost Property",
    tiv_kes: 5000000
  };
  const blockedResult = await processBrokerSlip(noGpsInput);
  assert(blockedResult.audit.is_blocked === true, "is_blocked = true when GPS is missing");
  assert(blockedResult.audit.block_reasons.some(r => r.includes("GPS coordinates missing")), "Contains GPS missing block reason");

  console.log("\n==================================================================");
  console.log(`   RESULTS: ${totalPassed} / ${totalTests} CHECKS PASSED (${Math.round(totalPassed/totalTests*100)}%)`);
  console.log("==================================================================\n");

  if (totalPassed === totalTests) {
    console.log("🎉 ALL INTAKE RULES FULLY VALIDATED! Dev 3 foundation is solid.");
    process.exit(0);
  } else {
    console.error("❌ SOME TESTS FAILED.");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
