/**
 * Automated Verification Test for Module 0 (Input Layer)
 * Validates a Landmark-shaped slip (inline string only — not shipped to the UI)
 * against docs/INTAKE.md and verifies all fallback paths.
 */

const { processBrokerSlip } = require('../src/intake/orchestrator');
const { extractFromSlip } = require("../src/intake/mockRAG");
const { applyFallbacks } = require("../src/intake/fallbackEngine");

const LANDMARK_SHAPED_SLIP = [
  "CONFIDENTIAL REINSURANCE PLACEMENT",
  "BROKER: Eastside Insurance Brokers Ltd",
  "REFERENCE: EIB-NAI-LP-2026-001",
  "DATE ISSUED: 8 October 2026",
  "",
  "CLIENT: Landmark Plaza Commercial Development (Landmark Realty Investment Limited)",
  "STREET ADDRESS: Lot 12, Block 2A, Upper Hill Area, Nairobi CBD",
  "GPS COORDINATES: -1.2847°S, 36.8247°E",
  "ELEVATION: 1,612 meters above sea level",
  "ADJACENT TO: Upper Hill Drive (main access road)",
  "",
  "The property comprises a premium commercial office building with ground floor retail",
  "spaces and two basement parking levels.",
  "",
  "Total Number of Floors: 18 (above ground) + 2 (basement)",
  "Basement Designation: B1 (parking level 1), B2 (parking level 2)",
  "GROSS FLOOR AREA: 24,500 m² (all levels combined)",
  "- Ground Floor: 2,150 m²",
  "- Typical Office Floor (F2-F17): 1,280 m² each",
  "- First Floor (Mezzanine retail): 1,850 m²",
  "- Basement levels: 2,100 m² each",
  "",
  "CONSTRUCTION CLASSIFICATION: RCC Frame with Shear Walls (Grade A+)",
  "Load-bearing walls constructed from reinforced concrete (M30 grade minimum)",
  "Building height (to roof edge): 64.8 meters",
  "Ground to first floor clearance: 4.2m (retail space)",
  "",
  "MAIN GENERATOR UNIT 1: Caterpillar C18 DITA, Location: Basement Level 1",
  "BACKUP GENERATOR UNIT 2: Caterpillar C15, Location: Basement Level 1",
  "Central chiller plant (2 units, 300 TR each, located B2 level)",
  "",
  "CLASS OF BUSINESS: Commercial Property (Multi-Story Office & Retail)",
  "COVERAGE TYPE: All-Risks (excluding flood) - flood cover available upon request",
  "INSURED INTEREST: Landmark Realty Investment Limited (owner/lessor);",
  "All occupying tenants/businesses operating within property",
  "",
  "FACULTATIVE FLOOD COVER (if requested):",
  "5% deductible or KES 5,000,000 minimum. Flood limit can be set at",
  "full TIV (KES 1,090,000,000) with confidence.",
].join("\n");

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
  console.log("[TEST 1] Verifying Landmark-shaped slip vs docs/INTAKE.md (inline test string)...");
  const landmark = await processBrokerSlip(LANDMARK_SHAPED_SLIP);

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
  assert(landmark.exposure.total_height_m.source === "extracted", "Height source = extracted");
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
  // TEST 2: Floors without height — do not invent m from class floor height
  // -------------------------------------------------------------
  console.log("\n[TEST 2] Verifying height stays null when only storeys are stated...");
  const missingHeightInput = {
    property_name: "Test Heights",
    lat: -1.290,
    lon: 36.820,
    housing_class: "permanent_masonry",
    floors_above_ground: 3,
    tiv_kes: 15000000
  };
  const heightResult = await processBrokerSlip(missingHeightInput);
  assert(heightResult.exposure.floors_above_ground.value === 3, "Floors extracted as 3");
  assert(heightResult.exposure.total_height_m == null, "Height stays null — not 3 × 3.5m");
  assert(heightResult.exposure.first_floor_height_m == null, "Plinth stays null — not class default");

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

  // -------------------------------------------------------------
  // TEST 5: Declared Sum Insured wins over GFA × Integrum median
  // -------------------------------------------------------------
  console.log("\n[TEST 5] Sum Insured on a non-Landmark slip must extract as TIV (not 21800×48000)...");
  const siSlip = [
    "PLACEMENT SLIP",
    "GROSS FLOOR AREA: 21,800 m²",
    "Sum Insured: KES 2,500,000,000",
    "CONSTRUCTION CLASSIFICATION: RCC Frame"
  ].join("\n");
  const siRaw = extractFromSlip(siSlip);
  assert(siRaw.floor_area_m2 === 21800, "GFA extracted as 21,800");
  assert(siRaw.tiv_kes === 2500000000, "Sum Insured extracted as 2,500,000,000");
  assert(siRaw.housing_class === "concrete_rcc", "RCC wording maps to concrete_rcc");
  const siResult = await processBrokerSlip(siRaw);
  assert(siResult.exposure.tiv_kes.value === 2500000000, "Canonical TIV is declared 2.5bn");
  assert(siResult.exposure.tiv_kes.source === "extracted", "TIV source = extracted");
  assert(siResult.exposure.tiv_kes.value !== 1046400000, "TIV is not 21,800 × 48,000");

  // -------------------------------------------------------------
  // TEST 6: GFA only — do not fabricate TIV or default class to masonry
  // -------------------------------------------------------------
  console.log("\n[TEST 6] GFA without TIV/class must leave TIV and class empty...");
  const gfaOnlyRaw = extractFromSlip(
    "PLACEMENT SLIP\nGROSS FLOOR AREA: 21,800 m²\nThe risk is situated in Nairobi."
  );
  assert(gfaOnlyRaw.floor_area_m2 === 21800, "GFA-only slip extracts 21,800 m²");
  assert(gfaOnlyRaw.tiv_kes == null, "GFA-only slip does not extract a TIV");
  assert(gfaOnlyRaw.housing_class == null, "GFA-only slip does not invent a class");
  const gfaOnly = applyFallbacks(gfaOnlyRaw);
  assert(gfaOnly.exposure.floor_area_m2.value === 21800, "GFA retained");
  assert(gfaOnly.exposure.tiv_kes == null, "TIV stays null — not 1,046,400,000");
  assert(gfaOnly.exposure.housing_class == null, "housing_class stays null (not permanent_masonry)");
  assert(gfaOnly.exposure.cost_per_m2_kes == null, "cost/m² not filled from Integrum median 48,000");
  assert(gfaOnly.exposure.floors_above_ground == null, "storeys stay null (not class_default)");
  assert(gfaOnly.exposure.total_height_m == null, "height stays null");
  assert(
    gfaOnly.audit.warnings.some((r) => r.includes("TIV not stated on slip")),
    "TIV missing is a warning, not an invented 1.046bn"
  );
  assert(
    !gfaOnly.audit.block_reasons.some((r) => r.includes("TIV not stated on slip")),
    "GFA present — missing TIV does not block the run"
  );

  // -------------------------------------------------------------
  // TEST 7: Alternate broker wording — extract stated fields, invent nothing
  // -------------------------------------------------------------
  console.log("\n[TEST 7] Alternate slip labels (address, SI, GFA, G+N, unsigned GPS)...");
  const altSlip = [
    "PLACEMENT SLIP",
    "INSURED: Westlands Warehouse Ltd",
    "RISK LOCATION: Parklands Road, Westlands, Nairobi",
    "Coordinates -1.2681, 36.8102",
    "Sum Insured: KES 80,000,000",
    "GROSS FLOOR AREA: 4,200 sqm",
    "CONSTRUCTION: stone masonry",
    "The risk is a G+1 warehouse.",
    "Building height: 8.5 m"
  ].join("\n");
  const altRaw = extractFromSlip(altSlip);
  assert(altRaw.property_name && altRaw.property_name.includes("Westlands Warehouse"), "Insured maps to property_name");
  assert(altRaw.address && altRaw.address.includes("Parklands Road"), "Risk Location maps to address");
  assert(altRaw.lat === -1.2681 && altRaw.lon === 36.8102, "Signed lat/lon pair extracted");
  assert(altRaw.tiv_kes === 80000000, "Sum Insured KES extracted");
  assert(altRaw.floor_area_m2 === 4200, "GFA sqm extracted");
  assert(altRaw.housing_class === "permanent_masonry", "stone masonry maps to permanent_masonry");
  assert(altRaw.floors_above_ground === 2, "G+1 maps to 2 floors above ground");
  assert(altRaw.total_height_m === 8.5, "Building height extracted");

  const tableGps = extractFromSlip(
    [
      "INSURED: Table GPS Ltd",
      "Latitude: -1.2921",
      "Longitude: 36.8219",
      "STREET ADDRESS: Kenyatta Avenue, Nairobi"
    ].join("\n")
  );
  assert(tableGps.lat === -1.2921 && tableGps.lon === 36.8219, "Table Latitude/Longitude lines extract GPS");

  const swappedHuman = applyFallbacks(
    { property_name: "Swapped pin" },
    { humanCoords: { lat: 36.8219, lon: -1.2921 } }
  );
  assert(swappedHuman.coordinates.lat.value === -1.2921, "Swapped human lat/lon is exchanged to Nairobi lat");
  assert(swappedHuman.coordinates.lon.value === 36.8219, "Swapped human lat/lon is exchanged to Nairobi lon");
  assert(swappedHuman.coordinates.lat.source === "human", "Swapped pin stays tagged human");

  const noGpsSlip = extractFromSlip(
    [
      "INSURED: Missing GPS Ltd",
      "STREET ADDRESS: Upper Hill, Nairobi",
      "Sum Insured: KES 12,000,000",
      "GROSS FLOOR AREA: 800 m2",
      "CONSTRUCTION CLASSIFICATION: RCC Frame",
      "Number of storeys: 4"
    ].join("\n")
  );
  assert(noGpsSlip.address && noGpsSlip.address.includes("Upper Hill"), "Address extracted when GPS absent");
  assert(noGpsSlip.lat == null && noGpsSlip.lon == null, "GPS stays not found when unstated");
  assert(noGpsSlip.tiv_kes === 12000000, "TIV extracted without GPS");
  assert(noGpsSlip.floors_above_ground === 4, "Number of storeys extracted");
  assert(noGpsSlip.total_height_m == null, "Height stays not found when unstated");
  assert(noGpsSlip.basement_floors == null, "Basement stays not found when unstated");

  const landmarkRaw = extractFromSlip(LANDMARK_SHAPED_SLIP);
  assert(landmarkRaw.address && landmarkRaw.address.includes("Upper Hill"), "Landmark street address extracted");
  assert(landmarkRaw.first_floor_height_m === 4.2, "Ground-to-first-floor clearance extracted as 4.2m");

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
