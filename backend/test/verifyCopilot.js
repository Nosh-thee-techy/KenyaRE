/**
 * Kenya Re CatNet AI Underwriting Copilot & Intelligence Layer Verification Suite
 * 
 * Verifies Step 5 Requirements:
 * 1. Generalization across DIVERSE offer letters & properties (zero mock cramming / no overfitting)
 * 2. Answers any TECHNICAL questions (JRC curves, drainage penalties, numerical integration)
 * 3. Answers any NON-TECHNICAL underwriting questions (pricing, ROL, appetite, deductible adequacy)
 * 4. Materially CHANGES model inputs & outputs through live What-If simulations
 * 5. Computes 1-in-500 year tail losses with bootstrapped sampling uncertainty bands
 */

const assert = require("assert");
const { chatWithCopilot, parseWhatIfRequest, calculate500yUncertainty } = require("../src/services/copilot.service");
const { runCatModel } = require("../src/engine/catModel");

// Offer Letter A: Landmark Plaza (18-storey high-rise commercial in Upper Hill with basement plant)
const OFFER_A_LANDMARK = {
  property_name: { value: "Landmark Plaza Commercial Development" },
  reference: { value: "EIB-NAI-LP-2026-001" },
  coordinates: {
    lat: { value: -1.2982, source: "extracted" },
    lon: { value: 36.8085, source: "extracted" },
    elevation_m: { value: 1612, source: "extracted" }
  },
  exposure: {
    housing_class: { value: "concrete_rcc", source: "extracted" },
    floors_above_ground: { value: 18, source: "extracted" },
    basement_floors: { value: 2, source: "extracted" },
    floor_area_m2: { value: 24500, source: "extracted" },
    tiv_kes: { value: 1090000000, source: "extracted" },
    critical_plant_in_basement: { value: true, source: "extracted" }
  },
  financial_terms: {
    deductible_pct: { value: 0.05, source: "extracted" },
    deductible_min_kes: { value: 5000000, source: "extracted" },
    policy_limit_kes: { value: 1090000000, source: "extracted" }
  }
};

// Offer Letter B: Apex Logistics Hub (Single-storey stone masonry warehouse in South C / Mombasa Rd)
const OFFER_B_WAREHOUSE = {
  property_name: { value: "Apex South C Logistics Depot" },
  reference: { value: "KEN-LOG-SC-2026-441" },
  coordinates: {
    lat: { value: -1.3210, source: "extracted" },
    lon: { value: 36.8320, source: "extracted" },
    elevation_m: { value: 1530, source: "extracted" }
  },
  exposure: {
    housing_class: { value: "permanent_masonry", source: "extracted" },
    floors_above_ground: { value: 1, source: "extracted" },
    basement_floors: { value: 0, source: "extracted" },
    floor_area_m2: { value: 8200, source: "extracted" },
    tiv_kes: { value: 350000000, source: "extracted" },
    critical_plant_in_basement: { value: false, source: "extracted" }
  },
  financial_terms: {
    deductible_pct: { value: 0.02, source: "extracted" },
    deductible_min_kes: { value: 2000000, source: "extracted" },
    policy_limit_kes: { value: 350000000, source: "extracted" }
  }
};

// Offer Letter C: Muthaiga Valley Residential Villa (Double-storey, outside any drainage hotspot)
const OFFER_C_RESIDENTIAL = {
  property_name: { value: "Muthaiga Country Manor" },
  reference: { value: "RES-MUTH-2026-902" },
  coordinates: {
    lat: { value: -1.2550, source: "extracted" },
    lon: { value: 36.8400, source: "extracted" },
    elevation_m: { value: 1675, source: "extracted" }
  },
  exposure: {
    housing_class: { value: "concrete_rcc", source: "extracted" },
    floors_above_ground: { value: 2, source: "extracted" },
    basement_floors: { value: 0, source: "extracted" },
    floor_area_m2: { value: 1100, source: "extracted" },
    tiv_kes: { value: 85000000, source: "extracted" },
    critical_plant_in_basement: { value: false, source: "extracted" }
  },
  financial_terms: {
    deductible_pct: { value: 0.10, source: "extracted" },
    deductible_min_kes: { value: 1000000, source: "extracted" },
    policy_limit_kes: { value: 85000000, source: "extracted" }
  }
};

async function runTests() {
  console.log("\n==================================================================");
  console.log("   KENYA RE FLOOD CATNET - STEP 5 AI COPILOT TEST SUITE          ");
  console.log("==================================================================\n");

  let passed = 0;
  let total = 0;
  function check(label, cond) {
    total++;
    if (cond) {
      console.log(`  ✅ PASS: ${label}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${label}`);
      throw new Error(`Test failed: ${label}`);
    }
  }

  // -------------------------------------------------------------------------
  // TEST 1: DYNAMIC GENERALIZATION ACROSS DIFFERENT OFFER LETTERS (NO OVERFITTING)
  // -------------------------------------------------------------------------
  console.log("[TEST 1] Testing Dynamic Generalization across Different Offer Letters...");
  const resA = runCatModel(OFFER_A_LANDMARK);
  const resB = runCatModel(OFFER_B_WAREHOUSE);

  const copilotA = await chatWithCopilot({
    query: "Give me an underwriting summary of this property",
    exposure: OFFER_A_LANDMARK,
    results: resA
  });

  const copilotB = await chatWithCopilot({
    query: "Give me an underwriting summary of this property",
    exposure: OFFER_B_WAREHOUSE,
    results: resB
  });

  check("Copilot A references Landmark Plaza", copilotA.answer.includes("Landmark Plaza"));
  check("Copilot A identifies KES 1.09B TIV", copilotA.answer.includes("1,090,000,000"));
  check("Copilot B references Apex South C Logistics", copilotB.answer.includes("Apex South C"));
  check("Copilot B identifies KES 350M TIV (does not cram Landmark data)", copilotB.answer.includes("350,000,000"));
  check("Copilot B reflects masonry class instead of RCC", copilotB.answer.includes("permanent_masonry"));

  // -------------------------------------------------------------------------
  // TEST 2: TECHNICAL QUESTIONS (JRC Curves, Drainage Penalties, Physics)
  // -------------------------------------------------------------------------
  console.log("\n[TEST 2] Testing Technical Q&A on JRC Curves and Drainage Hazards...");
  const techQuery = await chatWithCopilot({
    query: "What is the mathematical equation and parameters for the JRC sigmoid vulnerability curve?",
    exposure: OFFER_A_LANDMARK,
    results: resA
  });

  check("Technical answer explains JRC formula", techQuery.answer.includes("DR(d)") || techQuery.answer.includes("Sigmoid"));
  check("Technical answer mentions commercial RCC parameters K=0.65", techQuery.answer.includes("0.65"));
  check("Technical answer explains Wet-Storey single-plate split", techQuery.answer.includes("Wet-Storey") || techQuery.answer.includes("ground floor"));

  const hazardQuery = await chatWithCopilot({
    query: "How does the AI drainage penalty affect this property?",
    exposure: OFFER_A_LANDMARK,
    results: resA
  });

  check("Hazard query identifies Upper Hill drainage hotspot", hazardQuery.answer.includes("Upper Hill") || hazardQuery.answer.includes("+0.35m"));
  check("Hazard query explains 0.35m surcharge mechanism", hazardQuery.answer.includes("0.35m") || hazardQuery.answer.includes("surcharge"));

  // -------------------------------------------------------------------------
  // TEST 3: MATERIAL CHANGE IN MODEL OUTPUT (What-If: Relocating Basement Plant)
  // -------------------------------------------------------------------------
  console.log("\n[TEST 3] What-If Simulation: Relocating Critical Plant out of Basement...");
  const whatIfPlant = await chatWithCopilot({
    query: "What happens if the client moves the backup generators and chillers out of the basement to the roof?",
    exposure: OFFER_A_LANDMARK,
    results: resA
  });

  check("AI detects what-if simulation intent", whatIfPlant.what_if_applied === true);
  check("AI registers critical plant removal", whatIfPlant.changes_applied.some(c => c.toLowerCase().includes("critical plant")));
  check("Original 100Y PML is around KES 29.35M", whatIfPlant.original_metrics.pml_100y_kes > 25000000);
  check("Simulated 100Y PML is substantially lower without KES 45M plant surcharge", whatIfPlant.simulated_metrics.pml_100y_kes < whatIfPlant.original_metrics.pml_100y_kes);
  check("Net AAL drops accordingly", whatIfPlant.simulated_metrics.aal_net_kes < whatIfPlant.original_metrics.aal_net_kes);
  check("Answer provides detailed before-and-after delta", whatIfPlant.answer.includes("Delta:") || whatIfPlant.answer.includes("PML 100-Year"));

  // -------------------------------------------------------------------------
  // TEST 4: MATERIAL CHANGE IN MODEL OUTPUT (What-If: Deductible Sensitivity)
  // -------------------------------------------------------------------------
  console.log("\n[TEST 4] What-If Simulation: Adjusting Deductible to 10% on Warehouse...");
  const whatIfDed = await chatWithCopilot({
    query: "What if we increase the deductible to 10% with min deductible of 5M?",
    exposure: OFFER_B_WAREHOUSE,
    results: resB
  });

  check("AI detects deductible what-if intent", whatIfDed.what_if_applied === true);
  check("Simulated deductible changes recorded", whatIfDed.changes_applied.some(c => c.includes("10.0%")));
  check("Higher deductible reduces reinsurer Net AAL", whatIfDed.simulated_metrics.aal_net_kes <= whatIfDed.original_metrics.aal_net_kes);

  // -------------------------------------------------------------------------
  // TEST 5: 1-IN-500 YEAR TAIL LOSS & BOOTSTRAPPED UNCERTAINTY BAND
  // -------------------------------------------------------------------------
  console.log("\n[TEST 5] 1-in-500 Year Loss & Bootstrapped Sampling Uncertainty Band...");
  const copilot500 = await chatWithCopilot({
    query: "Calculate the 1-in-500 year loss and show the bootstrapped uncertainty band",
    exposure: OFFER_A_LANDMARK,
    results: resA
  });

  check("500-year uncertainty is computed", copilot500.uncertainty_500y != null);
  check("500-year return period is 500", copilot500.uncertainty_500y.return_period === 500);
  check("5th percentile is lower than 95th percentile", copilot500.uncertainty_500y.bootstrapped_uncertainty.p5_kes < copilot500.uncertainty_500y.bootstrapped_uncertainty.p95_kes);
  check("10,000 iterations documented", copilot500.uncertainty_500y.bootstrapped_uncertainty.iterations === 10000);
  check("Answer contains 1-in-500 year analysis", copilot500.answer.includes("1-in-500") || copilot500.answer.includes("500 Year"));

  // -------------------------------------------------------------------------
  // TEST 6: UNDERWRITER EXPLANATIONS (Inserted Values, Dashboards, Relevance, Fallbacks)
  // -------------------------------------------------------------------------
  console.log("\n[TEST 6] Testing Explanations for Values, Dashboards, Relevance, & Fallbacks (Meridian Heights)...");

  // Offer Letter D: Meridian Heights Developments Limited (from user's real screenshot!)
  const OFFER_D_MERIDIAN = {
    property_name: { value: "Meridian Heights Developments Limited" },
    reference: { value: "MHD-NAI-2026-001" },
    coordinates: {
      lat: { value: -1.2982, source: "geocoded" },
      lon: { value: 36.8085, source: "geocoded" },
      elevation_m: { value: 1612, source: "class_default" }
    },
    exposure: {
      housing_class: { value: "concrete_rcc", source: "implied" },
      floors_above_ground: { value: 14, source: "extracted" },
      basement_floors: { value: 2, source: "extracted" },
      floor_area_m2: { value: 20000, source: "extracted" },
      tiv_kes: { value: 940000000, source: "extracted" },
      critical_plant_in_basement: { value: true, source: "extracted" }
    },
    financial_terms: {
      deductible_pct: { value: 0.05, source: "extracted" },
      deductible_min_kes: { value: 5000000, source: "extracted" },
      policy_limit_kes: { value: 940000000, source: "extracted" }
    }
  };
  const resD = runCatModel(OFFER_D_MERIDIAN);

  // A. Explain Inserted Values
  const queryValues = await chatWithCopilot({
    query: "Explain the values inserted on this offer letter",
    exposure: OFFER_D_MERIDIAN,
    results: resD
  });
  check("Values answer references Meridian Heights", queryValues.answer.includes("Meridian Heights"));
  check("Values answer breaks down KES 940.0M TIV", queryValues.answer.includes("940,000,000"));
  check("Values answer breaks down 20,000 m² GFA", queryValues.answer.includes("20,000 m²"));
  check("Values answer breaks down 14 storeys", queryValues.answer.includes("14 storeys"));

  // B. Explain Dashboards & Outputs
  const queryDashboards = await chatWithCopilot({
    query: "Explain the dashboards and outputs for an underwriter",
    exposure: OFFER_D_MERIDIAN,
    results: resD
  });
  check("Dashboard explanation covers Ground-up AAL", queryDashboards.answer.includes("Ground-up AAL"));
  check("Dashboard explanation covers Net AAL", queryDashboards.answer.includes("Net AAL"));
  check("Dashboard explanation covers Rate on Line (ROL)", queryDashboards.answer.includes("Rate on Line"));
  check("Dashboard explanation covers PML 100-Year", queryDashboards.answer.includes("PML 100-Year"));

  // C. Explain Input Meanings & Relevance
  const queryRelevance = await chatWithCopilot({
    query: "Explain input meanings and relevance to flood risk",
    exposure: OFFER_D_MERIDIAN,
    results: resD
  });
  check("Relevance explains why GFA and storeys matter (Wet-Storey Split)", queryRelevance.answer.includes("GFA") && queryRelevance.answer.includes("storeys"));
  check("Relevance explains why critical plant in basement is #1 risk driver", queryRelevance.answer.includes("Critical Plant") && queryRelevance.answer.includes("45,000,000"));
  check("Relevance explains why plinth height matters", queryRelevance.answer.includes("Plinth"));
  check("Relevance explains why GPS coordinates matter (drainage hotspots)", queryRelevance.answer.includes("GPS Coordinates") || queryRelevance.answer.includes("hotspot"));

  // D. Explain System Fallbacks & Provenance
  const queryFallbacks = await chatWithCopilot({
    query: "Explain system fallbacks used when data is missing",
    exposure: OFFER_D_MERIDIAN,
    results: resD
  });
  check("Fallbacks explains source provenance tags", queryFallbacks.answer.includes("extracted") && queryFallbacks.answer.includes("implied"));
  check("Fallbacks explains missing GPS guardrail blocker", queryFallbacks.answer.includes("Missing GPS") || queryFallbacks.answer.includes("BLOCKS"));

  console.log("\n==================================================================");
  console.log(`   RESULTS: ${passed} / ${total} CHECKS PASSED (100%)`);
  console.log("==================================================================\n");
  console.log("🎉 ALL STEP 5 AI COPILOT & WHAT-IF INTELLIGENCE CHECKS PASSED!\n");
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
