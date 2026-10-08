/**
 * Kenya Re CatNet - Firestore Persistence Verification Test
 * Validates that the Canonical Exposure Schema is saved, fetched, and queried properly.
 */

const assert = require('assert');
const { saveExposure, getExposure, listExposures } = require('../src/services/firestore.service');

// Landmark Plaza fixture provided by user
const sampleCanonicalExposure = {
  property_name: "Landmark Plaza Commercial Development",
  reference: "EIB-NAI-LP-2026-001",
  coordinates: {
    lat: { value: -1.2847, source: "extracted" },
    lon: { value: 36.8247, source: "extracted" },
    elevation_m: { value: 1612, source: "extracted" },
    elevation_m_dem: null
  },
  exposure: {
    housing_class: { value: "concrete_rcc", source: "extracted" },
    occupancy: { value: "commercial", source: "derived" },
    floor_area_m2: { value: 24500, source: "extracted" },
    floors_above_ground: { value: 18, source: "extracted" },
    total_height_m: { value: 64.8, source: "extracted" },
    basement_floors: { value: 2, source: "extracted" },
    first_floor_height_m: null,
    critical_plant_in_basement: { value: true, source: "extracted" },
    tiv_kes: { value: 1090000000, source: "extracted" },
    cost_per_m2_kes: { value: 44489.8, source: "implied" }
  },
  coverage: {
    class_of_business: {
      value: "Commercial Property (Multi-Story Office & Retail)",
      source: "extracted"
    },
    coverage_type: {
      value: "All-Risks (excluding flood)",
      source: "extracted"
    },
    flood_cover_requested: { value: true, source: "extracted" },
    cover_subject: { value: "both", source: "derived" },
    insured_interest: ["owner/lessor", "occupying tenants"]
  },
  financial_terms: {
    deductible_pct: { value: 0.05, source: "extracted" },
    deductible_min_kes: { value: 5000000, source: "extracted" },
    policy_limit_kes: { value: 1090000000, source: "extracted" },
    vital_considerations: []
  },
  audit: {
    is_blocked: false,
    block_reasons: [],
    warnings: []
  }
};

async function runTests() {
  console.log("\n==================================================================");
  console.log("   KENYA RE FLOOD CATNET - FIRESTORE PERSISTENCE TEST SUITE      ");
  console.log("==================================================================\n");

  let passed = 0;
  let total = 0;

  function testCheck(desc, condition) {
    total++;
    if (condition) {
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
    }
  }

  try {
    // 1. Save Document
    console.log("[TEST 1] Saving Landmark Plaza canonical exposure schema to Firestore...");
    const saveResult = await saveExposure(sampleCanonicalExposure);
    testCheck("Save operation returned success", saveResult.success === true);
    testCheck("Document ID matches reference or is generated", saveResult.id === "EIB-NAI-LP-2026-001");
    testCheck("Collection is 'exposures'", saveResult.collection === "exposures");

    // 2. Retrieve Document
    console.log("\n[TEST 2] Retrieving exposure record by Reference/ID...");
    const fetched = await getExposure("EIB-NAI-LP-2026-001");
    testCheck("Record successfully fetched", fetched !== null);
    testCheck("Property name matches", fetched.property_name === "Landmark Plaza Commercial Development");
    testCheck("Latitude is preserved with source tag", fetched.coordinates.lat.value === -1.2847 && fetched.coordinates.lat.source === "extracted");
    testCheck("Longitude is preserved with source tag", fetched.coordinates.lon.value === 36.8247 && fetched.coordinates.lon.source === "extracted");
    testCheck("TIV is preserved with source tag", fetched.exposure.tiv_kes.value === 1090000000 && fetched.exposure.tiv_kes.source === "extracted");
    testCheck("Basement critical plant flag is preserved", fetched.exposure.critical_plant_in_basement.value === true);
    testCheck("Coverage subject is preserved", fetched.coverage.cover_subject.value === "both");
    testCheck("Deductible terms preserved", fetched.financial_terms.deductible_pct.value === 0.05 && fetched.financial_terms.deductible_min_kes.value === 5000000);
    testCheck("Audit blocked status is preserved", fetched.audit.is_blocked === false);

    // 3. List Exposures
    console.log("\n[TEST 3] Listing exposure records...");
    const list = await listExposures(10);
    testCheck("List returns array of exposures", Array.isArray(list) && list.length > 0);
    const landmarkFound = list.some(item => item.reference === "EIB-NAI-LP-2026-001");
    testCheck("Landmark Plaza found in listing", landmarkFound);

    console.log("\n==================================================================");
    console.log(`   RESULTS: ${passed} / ${total} CHECKS PASSED (${Math.round((passed / total) * 100)}%)`);
    console.log("==================================================================\n");

    if (passed === total) {
      console.log("🎉 FIRESTORE EXPOSURE PERSISTENCE FULLY VERIFIED!\n");
    } else {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("Test execution error:", err);
    process.exitCode = 1;
  }
}

runTests();
