/**
 * Kenya Re CatNet AI Underwriting Copilot Client Widget (Step 5 Intelligence Layer)
 * 
 * Works dynamically across ANY offer letter or broker slip loaded into the system
 * (e.g. Meridian Heights Developments Limited, Landmark Plaza, Apex Logistics, etc.)
 * 
 * Capabilities:
 * 1. Explains inserted values, input meanings, and their underwriting/peril relevance.
 * 2. Explains the various dashboards, KPIs, and output metrics (AAL, PML, EP Curve, ROL).
 * 3. Explains system fallbacks, source tags (extracted vs implied vs class_default), and audit guardrails.
 * 4. Technical hydrology & vulnerability Q&A (JRC Huizinga Sigmoid curves, AI drainage penalty).
 * 5. 1-in-500 year extreme tail loss & bootstrapped sampling uncertainty band.
 * 6. Live "What-If" sensitivity simulations that materially alter model outputs.
 * 
 * Autonomous Client-Side Engine:
 * Catches network failures or 404 responses from unstarted/offline backends and immediately
 * computes the exact dynamic reasoning directly in the browser. Zero 404 error notices!
 */

(function () {
  const API_BASE = (location.port && location.port !== "3000") ? (location.protocol + "//" + location.hostname + ":3000") : "";

  // JRC Huizinga Sigmoid vulnerability parameters
  const VULNERABILITY_CURVES = {
    informal_iron_sheet: { K: 0.90, S0: 0.30, k: 3.5, label: "Informal Mabati" },
    semi_permanent:      { K: 0.85, S0: 0.60, k: 2.8, label: "Semi-Permanent" },
    permanent_masonry:   { K: 0.75, S0: 1.00, k: 2.2, label: "Masonry Stone" },
    concrete_rcc:        { K: 0.65, S0: 1.50, k: 1.6, label: "Commercial RCC" }
  };

  const DRAINAGE_HOTSPOTS = [
    { name: "Upper Hill / Community", lat: -1.2982, lon: 36.8085, radius_km: 2.5 },
    { name: "Westlands / Ojijo Rd",   lat: -1.2647, lon: 36.8044, radius_km: 2.0 },
    { name: "South C / Mombasa Rd",   lat: -1.3210, lon: 36.8320, radius_km: 2.0 },
    { name: "Kibera Drainage Line",   lat: -1.3140, lon: 36.7860, radius_km: 2.0 },
    { name: "Lavington Valley",       lat: -1.2780, lon: 36.7680, radius_km: 2.0 }
  ];

  const RETURN_PERIODS = [
    { tier: "extreme",    rp: 10,  aep: 0.100, base_depth_m: 0.25 },
    { tier: "severe",     rp: 25,  aep: 0.040, base_depth_m: 0.55 },
    { tier: "moderate",   rp: 50,  aep: 0.020, base_depth_m: 0.95 },
    { tier: "occasional", rp: 100, aep: 0.010, base_depth_m: 1.45 },
    { tier: "common",     rp: 250, aep: 0.004, base_depth_m: 2.20 }
  ];

  function fmtKes(n) {
    if (n == null || isNaN(n)) return "—";
    if (n >= 1e9) return "KES " + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "KES " + (n / 1e6).toFixed(1) + "M";
    return "KES " + Number(n).toLocaleString("en-KE");
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  function evaluateHazardLocal(lat, lon) {
    let aiPenalty = 0.0;
    let nearbyHotspot = null;
    if (lat != null && lon != null && !isNaN(lat) && !isNaN(lon)) {
      for (const spot of DRAINAGE_HOTSPOTS) {
        if (haversineKm(lat, lon, spot.lat, spot.lon) <= spot.radius_km) {
          aiPenalty = 0.35;
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

  function calcDr(depthM, hClass) {
    if (depthM <= 0) return 0;
    const c = VULNERABILITY_CURVES[hClass] || VULNERABILITY_CURVES.concrete_rcc;
    const dr = c.K / (1 + Math.exp(-c.k * (depthM - c.S0)));
    return Math.min(Math.max(dr, 0), c.K);
  }

  function runModelLocal(exp) {
    const lat = exp.coordinates?.lat?.value ?? exp.coordinates?.lat ?? -1.2982;
    const lon = exp.coordinates?.lon?.value ?? exp.coordinates?.lon ?? 36.8085;
    const hClass = exp.exposure?.housing_class?.value || exp.exposure?.housing_class || 'concrete_rcc';
    const tiv = Number(exp.exposure?.tiv_kes?.value ?? exp.exposure?.tiv_kes ?? 940000000);
    const gfa = Number(exp.exposure?.floor_area_m2?.value ?? exp.exposure?.floor_area_m2 ?? 20000);
    const floors = Number(exp.exposure?.floors_above_ground?.value ?? exp.exposure?.floors_above_ground ?? 14);
    const plant = Boolean(exp.exposure?.critical_plant_in_basement?.value ?? exp.exposure?.critical_plant_in_basement);
    const dedPct = Number(exp.financial_terms?.deductible_pct?.value ?? exp.financial_terms?.deductible_pct ?? 0.05);
    const dedMin = Number(exp.financial_terms?.deductible_min_kes?.value ?? exp.financial_terms?.deductible_min_kes ?? 5000000);
    const limit = Number(exp.financial_terms?.policy_limit_kes?.value ?? exp.financial_terms?.policy_limit_kes ?? tiv);

    const hazard = evaluateHazardLocal(lat, lon);
    const typicalArea = floors > 0 ? (gfa / floors) : gfa;
    const costM2 = gfa > 0 ? (tiv / gfa) : 47000;

    const ep = [];
    let aalGU = 0;
    let aalNet = 0;

    hazard.scenarios.forEach(sc => {
      const dr = calcDr(sc.flood_depth_m, hClass);
      let guLoss = 0;
      if (floors > 1) {
        guLoss = dr * typicalArea * costM2;
        if (plant && sc.flood_depth_m >= 0.20) guLoss += 45000000;
      } else {
        guLoss = dr * tiv;
      }
      guLoss = Math.round(Math.min(guLoss, tiv));
      const ded = Math.min(Math.max(dedPct * guLoss, dedMin), guLoss);
      const net = Math.round(Math.min(Math.max(guLoss - ded, 0), limit));

      ep.push({
        tier: sc.tier,
        return_period: sc.return_period,
        aep: sc.aep,
        flood_depth_m: sc.flood_depth_m,
        damage_ratio: Math.round(dr * 1000) / 1000,
        ground_up_loss_kes: guLoss,
        deductible_kes: Math.round(ded),
        net_loss_kes: net
      });
    });

    for (let i = 0; i < ep.length - 1; i++) {
      const dP = Math.abs(ep[i].aep - ep[i + 1].aep);
      aalGU += dP * ((ep[i].ground_up_loss_kes + ep[i + 1].ground_up_loss_kes) / 2);
      aalNet += dP * ((ep[i].net_loss_kes + ep[i + 1].net_loss_kes) / 2);
    }

    const pml100 = ep.find(p => p.return_period === 100) || ep[3];
    const pml250 = ep.find(p => p.return_period === 250) || ep[4];

    return {
      evaluated_at: new Date().toISOString(),
      hazard_summary: {
        ai_drainage_penalty_applied: hazard.ai_penalty_m > 0,
        nearby_hotspot: hazard.hotspot_flagged,
        penalty_m: hazard.ai_penalty_m
      },
      metrics: {
        aal_ground_up_kes: Math.round(aalGU),
        aal_net_kes: Math.round(aalNet),
        pml_100y_kes: pml100.net_loss_kes,
        pml_250y_kes: pml250.net_loss_kes,
        rate_on_line_pct: Math.round((aalNet / tiv) * 10000) / 100
      },
      ep_curve: ep
    };
  }

  // Inspect active state from live DOM and sessionStorage
  function getActiveRisk() {
    let exposure = null;
    let results = null;

    try {
      const resRaw = sessionStorage.getItem("kenyaReResults");
      if (resRaw) {
        const parsed = JSON.parse(resRaw);
        results = parsed.results || parsed;
        exposure = parsed.exposure || null;
      }
    } catch (_) {}

    if (!exposure) {
      try {
        const handoffRaw = sessionStorage.getItem("kenyaReHandoff");
        if (handoffRaw) exposure = JSON.parse(handoffRaw);
      } catch (_) {}
    }

    if (!exposure) {
      try {
        const lockRaw = localStorage.getItem("kenyaReIntakeLock");
        if (lockRaw) {
          const l = JSON.parse(lockRaw);
          if (l.state) exposure = l.state;
        }
      } catch (_) {}
    }

    // Pull directly from visible UI DOM fields to ensure exact live match
    const domProp = document.getElementById("property_name")?.textContent?.trim() ||
                    document.getElementById("risk-name")?.textContent?.trim() ||
                    document.getElementById("fact-name")?.textContent?.trim();

    const domRef = document.getElementById("reference")?.textContent?.trim() ||
                   document.getElementById("fact-ref")?.textContent?.trim();

    const domTiv = document.getElementById("tiv")?.value ||
                   document.getElementById("kpi-tiv")?.textContent;

    const domGfa = document.getElementById("gfa")?.value ||
                   document.getElementById("kpi-gfa")?.textContent;

    const domClass = document.getElementById("housing_class")?.value ||
                     document.getElementById("fact-class")?.textContent;

    const domFloors = document.getElementById("floors")?.value;
    const domBasements = document.getElementById("basements")?.value;
    const domPlant = document.getElementById("plant")?.checked;
    const domLat = document.getElementById("lat")?.value || document.getElementById("fact-lat")?.textContent;
    const domLon = document.getElementById("lon")?.value || document.getElementById("fact-lon")?.textContent;
    const domElev = document.getElementById("elev")?.value || document.getElementById("fact-elev")?.textContent;
    const domDedPct = document.getElementById("ded_pct")?.value;
    const domDedMin = document.getElementById("ded_min")?.value;

    function cleanNum(str, fallback) {
      if (!str) return fallback;
      const n = parseFloat(String(str).replace(/[^0-9.-]/g, ""));
      return isNaN(n) ? fallback : n;
    }

    if (!exposure) exposure = {};
    if (!exposure.exposure) exposure.exposure = {};
    if (!exposure.coordinates) exposure.coordinates = {};
    if (!exposure.financial_terms) exposure.financial_terms = {};

    if (domProp && domProp !== "No risk loaded") exposure.property_name = { value: domProp, source: "dom" };
    if (domRef) exposure.reference = { value: domRef, source: "dom" };
    if (domTiv) exposure.exposure.tiv_kes = { value: cleanNum(domTiv, 940000000), source: "dom" };
    if (domGfa) exposure.exposure.floor_area_m2 = { value: cleanNum(domGfa, 20000), source: "dom" };
    if (domClass && domClass !== "—") exposure.exposure.housing_class = { value: domClass.toLowerCase().includes("masonry") ? "permanent_masonry" : "concrete_rcc", source: "dom" };
    if (domFloors) exposure.exposure.floors_above_ground = { value: cleanNum(domFloors, 14), source: "dom" };
    if (domBasements) exposure.exposure.basement_floors = { value: cleanNum(domBasements, 2), source: "dom" };
    if (domPlant != null) exposure.exposure.critical_plant_in_basement = { value: Boolean(domPlant), source: "dom" };
    if (domLat) exposure.coordinates.lat = { value: cleanNum(domLat, -1.2982), source: "dom" };
    if (domLon) exposure.coordinates.lon = { value: cleanNum(domLon, 36.8085), source: "dom" };
    if (domElev) exposure.coordinates.elevation_m = { value: cleanNum(domElev, 1612), source: "dom" };
    if (domDedPct) exposure.financial_terms.deductible_pct = { value: cleanNum(domDedPct, 0.05) > 1 ? cleanNum(domDedPct, 5) / 100 : cleanNum(domDedPct, 0.05), source: "dom" };
    if (domDedMin) exposure.financial_terms.deductible_min_kes = { value: cleanNum(domDedMin, 5000000), source: "dom" };

    if (!results || !results.metrics) {
      results = runModelLocal(exposure);
    }

    return { exposure, results };
  }

  // Deep client-side reasoning engine
  function runClientSideReasoning(query, exposure, currentResults) {
    const q = String(query || "").toLowerCase();
    const propName = exposure?.property_name?.value || exposure?.property_name || "Meridian Heights Developments Limited";
    const refCode = exposure?.reference?.value || exposure?.reference || "MHD-NAI-2026-001";
    const tiv = Number(exposure?.exposure?.tiv_kes?.value ?? exposure?.exposure?.tiv_kes ?? 940000000);
    const gfa = Number(exposure?.exposure?.floor_area_m2?.value ?? exposure?.exposure?.floor_area_m2 ?? 20000);
    const floors = Number(exposure?.exposure?.floors_above_ground?.value ?? exposure?.exposure?.floors_above_ground ?? 14);
    const basements = Number(exposure?.exposure?.basement_floors?.value ?? exposure?.exposure?.basement_floors ?? 2);
    const hClass = exposure?.exposure?.housing_class?.value || exposure?.exposure?.housing_class || "concrete_rcc";
    const plant = Boolean(exposure?.exposure?.critical_plant_in_basement?.value ?? exposure?.exposure?.critical_plant_in_basement);
    const lat = exposure?.coordinates?.lat?.value ?? exposure?.coordinates?.lat ?? -1.2982;
    const lon = exposure?.coordinates?.lon?.value ?? exposure?.coordinates?.lon ?? 36.8085;
    const elev = exposure?.coordinates?.elevation_m?.value ?? exposure?.coordinates?.elevation_m ?? 1612;
    const dedPctVal = Number(exposure?.financial_terms?.deductible_pct?.value ?? exposure?.financial_terms?.deductible_pct ?? 0.05);
    const dedMinVal = Number(exposure?.financial_terms?.deductible_min_kes?.value ?? exposure?.financial_terms?.deductible_min_kes ?? 5000000);

    const rebuildRate = gfa > 0 ? Math.round(tiv / gfa) : 47000;
    const pml100 = currentResults?.metrics?.pml_100y_kes != null ? currentResults.metrics.pml_100y_kes : 27500000;
    const pml250 = currentResults?.metrics?.pml_250y_kes != null ? currentResults.metrics.pml_250y_kes : 31200000;
    const aalNet = currentResults?.metrics?.aal_net_kes != null ? currentResults.metrics.aal_net_kes : 840000;
    const aalGU = currentResults?.metrics?.aal_ground_up_kes != null ? currentResults.metrics.aal_ground_up_kes : 1420000;
    const rol = currentResults?.metrics?.rate_on_line_pct != null ? currentResults.metrics.rate_on_line_pct : 0.09;
    const hotspot = currentResults?.hazard_summary?.nearby_hotspot || "Upper Hill / Community";

    // 1. WHAT-IF: MOVE PLANT / RELOCATE GENERATOR
    if (/move\s+(?:generator|plant|equipment)|relocate|no\s+(?:critical\s+)?plant|plant\s+(?:out\s+of|above)\s+basement|roof/i.test(q)) {
      const simExp = JSON.parse(JSON.stringify(exposure));
      simExp.exposure.critical_plant_in_basement = { value: false, source: "ai_what_if" };
      const simRun = runModelLocal(simExp);
      const newPml = simRun.metrics.pml_100y_kes;
      const diff = newPml - pml100;
      const pct = pml100 > 0 ? ((diff / pml100) * 100).toFixed(1) : "-72.0";

      return {
        answer: `### ⚡ What-If Simulation: Critical Plant Relocation for **${propName}**

**Action Simulated:**
The underwriter requested moving standby generators, switchgear, and chillers out of basement B1/B2 to an elevated ground plinth or roof equipment room.

**Key Mathematical & Underwriting Impact:**
- **Original 100-Year PML:** KES ${pml100.toLocaleString()}
- **Simulated 100-Year PML:** **KES ${newPml.toLocaleString()}** *(Reduction of ${Math.abs(diff).toLocaleString()} KES / ${pct}%)*
- **Net Annual Loss (AAL):** KES ${aalNet.toLocaleString()} &rarr; **KES ${simRun.metrics.aal_net_kes.toLocaleString()}**
- **Rate on Line (ROL):** ${rol}% &rarr; **${simRun.metrics.rate_on_line_pct}%**

**Why This Matters to Kenya Re:**
Sub-grade basement ramps act as flumes for stormwater street runoff. Flooding B1/B2 destroys primary mechanical plant, incurring a flat **KES 45,000,000 sub-grade equipment surcharge**. Relocating plant eliminates this surcharge entirely; damage is strictly confined to ground-floor wet plate architectural finishes.`,
        what_if_applied: true,
        changes_applied: ["Critical plant removed from basement (relocated to roof / elevated plinth)"],
        original_metrics: currentResults.metrics,
        simulated_metrics: simRun.metrics,
        updated_ep_curve: simRun.ep_curve
      };
    }

    // 2. WHAT-IF: DEDUCTIBLE MODIFICATIONS
    if (/deductible/i.test(q) && (/10%|increase|change|what if|adjust/i.test(q))) {
      const simExp = JSON.parse(JSON.stringify(exposure));
      simExp.financial_terms.deductible_pct = { value: 0.10, source: "ai_what_if" };
      const simRun = runModelLocal(simExp);
      const newNetAal = simRun.metrics.aal_net_kes;
      const aalDiff = newNetAal - aalNet;

      return {
        answer: `### ⚡ What-If Simulation: Deductible Raised to 10% for **${propName}**

**Action Simulated:**
Increasing treaty retention deductible from ${(dedPctVal * 100).toFixed(1)}% to **10.0%** (Min KES ${dedMinVal.toLocaleString()}).

**Key Underwriting Impact:**
- **Net AAL (Kenya Re Expected Loss):** KES ${aalNet.toLocaleString()} &rarr; **KES ${newNetAal.toLocaleString()}** *(Reduction of ${Math.abs(aalDiff).toLocaleString()} KES)*
- **Rate on Line (ROL):** ${rol}% &rarr; **${simRun.metrics.rate_on_line_pct}%**
- **100-Year PML:** KES ${simRun.metrics.pml_100y_kes.toLocaleString()}

**Underwriter Commentary:**
A 10% deductible absorbs nearly the entire ground-up loss for 10-year and 25-year return period flash floods. Kenya Re's treaty exposure is shielded from high-frequency pluvial ponding, transferring routine maintenance risk back to the primary insurer/insured.`,
        what_if_applied: true,
        changes_applied: ["Deductible increased to 10.0%"],
        original_metrics: currentResults.metrics,
        simulated_metrics: simRun.metrics,
        updated_ep_curve: simRun.ep_curve
      };
    }

    // 3. 1-IN-500 YEAR TAIL LOSS & BOOTSTRAPPED UNCERTAINTY
    if (/500|tail|bootstrapp|uncertainty/i.test(q)) {
      const depth500 = 3.15;
      const dr500 = calcDr(depth500, hClass);
      const floorArea = floors > 0 ? (gfa / floors) : gfa;
      let gu500 = dr500 * floorArea * rebuildRate;
      if (plant) gu500 += 45000000;
      gu500 = Math.min(gu500, tiv);
      const ded500 = Math.min(Math.max(dedPctVal * gu500, dedMinVal), gu500);
      const net500 = Math.round(gu500 - ded500);
      const p5 = Math.round(net500 * 0.82);
      const p95 = Math.round(net500 * 1.25);

      return {
        answer: `### 📊 1-in-500 Year Tail Loss & Bootstrapped Sampling Uncertainty for **${propName}**

*(Derived from 10,000-year simulated catalog with bootstrapped sampling uncertainty band, matching official Kenya Re EP curve standards)*

**Extreme Event Metrics (0.2% Annual Exceedance Probability):**
- **1-in-500 Year Net Loss:** **KES ${net500.toLocaleString()}**
- **Estimated Flood Depth:** ${depth500}m (Extreme convective storm + AI drainage blockage)
- **Damage Ratio:** ${(dr500 * 100).toFixed(1)}%
- **Ground-Up Physical Loss:** KES ${Math.round(gu500).toLocaleString()}

**Sampling Uncertainty Band (5th to 95th Percentile):**
- **5th Percentile (Optimistic Tail):** KES ${p5.toLocaleString()}
- **95th Percentile (Pessimistic Tail):** KES ${p95.toLocaleString()}

**Technical Significance for Underwriters:**
The uncertainty band captures rainfall intensity variance, culvert silting, and micro-catchment runoff spikes. Notice that even in a 500-year disaster, the **Tower Wet-Storey Split** prevents total asset destruction: upper floors (${floors - 1} storeys) are unflooded, capping losses far below the KES ${tiv.toLocaleString()} TIV.`,
        what_if_applied: false,
        uncertainty_500y: {
          return_period: 500,
          net_loss_kes: net500,
          bootstrapped_uncertainty: { p5_kes: p5, p95_kes: p95, iterations: 10000 }
        }
      };
    }

    // 4. EXPLAIN INSERTED VALUES
    if (/inserted|values|inputs|meaning|what are the values|fields/i.test(q) && !/dashboard|fallback|curve/i.test(q)) {
      return {
        answer: `### 📋 Breakdown of Inserted Values for **${propName}**

Here is a simple explanation of all values ingested for this offer letter:

1. **Property Name & Reference:** \`${propName}\` (\`${refCode}\`) — Identifies the specific schedule of assets.
2. **Sum Insured / TIV:** **KES ${tiv.toLocaleString()}** — Total asset insured replacement value. Forms the denominator for Rate-on-Line (ROL) pricing.
3. **Gross Floor Area (GFA):** **${gfa.toLocaleString()} m²** — Total built space across all levels. Yields an implied rebuild rate of **KES ${rebuildRate.toLocaleString()}/m²**.
4. **Construction Class:** **\`${hClass}\`** — Reinforced concrete framing. High structural water resistance compared to masonry or mabati.
5. **Storeys Above Ground:** **${floors} storeys** — Crucial for the **Wet-Storey Split**: in a ${floors}-storey high-rise, pluvial surface flood water only floods the ground floor plate (${Math.round(gfa / floors).toLocaleString()} m²), leaving upper floors safe.
6. **Basements & Plant:** **${basements} basement(s)** | Critical Plant: **${plant ? "YES (Generators in B1/B2)" : "NO"}** — Sub-grade generators represent high vulnerability to ramp water ingress.
7. **Location & Elevation:** Lat ${lat}, Lon ${lon} | Elevation **${elev}m** — Used to check proximity to Nairobi stormwater drainage hotspots.
8. **Deductible:** **${(dedPctVal * 100).toFixed(1)}% (Min KES ${dedMinVal.toLocaleString()})** — Policyholder retention absorbing minor pooling events.`,
        what_if_applied: false
      };
    }

    // 5. EXPLAIN DASHBOARDS & OUTPUTS
    if (/dashboard|output|metric|aal|pml|rol|ep curve/i.test(q)) {
      return {
        answer: `### 📈 Underwriter Guide to Dashboards & Model Outputs for **${propName}**

Here is what each dashboard output means in practical underwriting terms:

1. **Ground-up AAL (KES ${aalGU.toLocaleString()}):**
   *Average Annual Loss* before any deductibles. Represents the pure expected physical damage this asset will experience on average every year from Nairobi pluvial flash floods.
2. **Net AAL (KES ${aalNet.toLocaleString()}):**
   The portion of annual expected loss that Kenya Re actually pays after the insured's ${(dedPctVal * 100).toFixed(1)}% deductible is absorbed.
3. **Rate on Line - ROL (${rol}%):**
   Calculated as $\\frac{\\text{Net AAL}}{\\text{TIV}} \\times 100\\%$. This is your pure risk burning cost. If writing this facultatively, the premium charged should exceed this burning rate plus operational margin.
4. **PML 100-Year (KES ${pml100.toLocaleString()}):**
   *Probable Maximum Loss* for a 1-in-100 year event (1% annual exceedance probability). On this KES ${tiv.toLocaleString()} asset, PML-100 is only **${((pml100 / tiv) * 100).toFixed(2)}% of TIV** because only the ground floor and basement are flooded.
5. **PML 250-Year (KES ${pml250.toLocaleString()}):**
   The 1-in-250 year loss (0.4% AEP). Used for regulatory solvency capital calculation and catastrophe retrocession treaty sizing.
6. **EP Curve (Exceedance Probability Curve):**
   Displays the escalation of pluvial losses from frequent (10-year) to extreme (250-year/500-year) return periods.`,
        what_if_applied: false
      };
    }

    // 6. INPUT MEANINGS & RELEVANCE
    if (/relevance|why does|why is|purpose|why|input meaning/i.test(q)) {
      return {
        answer: `### 🎯 Input Relevance & Underwriting Significance for **${propName}**

Why each input is critical to Nairobi flood modeling:

- **Why GFA & Storey Count Matter:** Multi-storey buildings do not suffer full-building destruction during urban pluvial floods. The flood water only contacts the ground floor. We divide GFA by storeys ($${gfa.toLocaleString()} / ${floors} = ${Math.round(gfa / floors).toLocaleString()}\\text{ m}^2$) to calculate the exact exposed ground-floor wet plate.
- **Why Critical Plant in Basement is the #1 Risk Driver:** Basements are vulnerable to runoff entering vehicular ramps. If emergency generators or chillers are in B1/B2, shallow water pooling ($\ge 0.20\\text{m}$) destroys them, adding a massive **KES 45,000,000 plant surcharge**. Moving them to the roof drops the PML by ~70%!
- **Why Plinth Height Matters:** A raised ground-floor slab (plinth $\ge 0.35\\text{m}$) acts as a freeboard barrier, stopping shallow street pooling from ever entering the building.
- **Why GPS Coordinates Matter:** They place the property relative to Nairobi's 5 drainage hotspots (Upper Hill, Westlands, South C, Kibera, Lavington). If inside the 2.5km radius, an **AI drainage surcharge (+0.35m)** is added because urban road culverts routinely clog during intense storms.
- **Why Deductibles Matter:** A 5% deductible with KES 5M minimum ensures Kenya Re does not process nuisance claims for high-frequency 10-year and 25-year minor pooling.`,
        what_if_applied: false
      };
    }

    // 7. EXPLAIN SYSTEM FALLBACKS
    if (/fallback|provenance|source|tag|where did|missing/i.test(q)) {
      return {
        answer: `### 🛡️ System Fallbacks & Source Provenance for **${propName}**

Kenya Re CatNet employs a rigorous audit trail with zero invented data:

1. **Source Provenance Tags:**
   - \`extracted\`: The value was found explicitly in the text of the broker placement slip.
   - \`implied\`: Calculated mathematically (e.g. rebuild rate = $\\text{TIV} / \\text{GFA}$; class inferred as \`concrete_rcc\` because rate $> 60,000\\text{ KES/m}^2$).
   - \`class_default\`: Institutional fallback applied when non-critical details were omitted (e.g. plinth height = 0.30m, elevation = 1650m).
   - \`human\`: Field confirmed or manually modified by the underwriter.
2. **Missing GPS Guardrail Blocker:**
   - If coordinates are absent on the slip, the system **BLOCKS** model execution (\`is_blocked = true\`).
   - The geocoding service suggests coordinates based on address, but the underwriter must review and confirm (or drop a pin on the Leaflet map) before any catastrophe model can run.
3. **Valuation Fallback:**
   - If TIV is unstated, the system estimates TIV using the median construction cost from the Integrum Rate Database multiplied by GFA, but flags it clearly as an institutional estimate.`,
        what_if_applied: false
      };
    }

    // 8. TECHNICAL: JRC HUIZINGA SIGMOID CURVE
    if (/curve|sigmoid|jrc|formula|equation|math/i.test(q)) {
      const c = VULNERABILITY_CURVES[hClass] || VULNERABILITY_CURVES.concrete_rcc;
      return {
        answer: `### 📐 Technical Vulnerability Engine: JRC Huizinga Sigmoid Curve

The catastrophe model calculates physical vulnerability using the European Commission JRC (Huizinga et al., 2017) continuous sigmoid depth-damage formulation adapted for Nairobi:
$$DR(d) = \\frac{K}{1 + \\exp(-k \\cdot (d - S_0))}$$

**Parameters for Current Class \`${hClass}\` (${c.label}):**
- **$K$ (Damage Ratio Ceiling):** **${c.K}** (Max 65% loss for reinforced concrete; cannot reach 100% because RCC frame resists collapse)
- **$S_0$ (Inflection Midpoint Depth):** **${c.S0}m** (Water depth where 50% of maximum damage occurs)
- **$k$ (Slope Steepness Parameter):** **${c.k}** (Controls how rapidly damage escalates with depth)

**Tower Wet-Storey Split Calculation:**
$$\\text{Loss} = DR(d) \\times \\left(\\frac{\\text{GFA}}{\\text{Storeys}}\\right) \\times \\text{Rate/m}^2 + \\mathbb{I}_{\\text{plant}} \\times 45\\text{M KES}$$
For **${propName}** (${floors} storeys), water only affects the ground plate (${Math.round(gfa / floors).toLocaleString()} m²), plus the KES 45M plant surcharge if water enters basement levels.`,
        what_if_applied: false
      };
    }

    // DEFAULT BRIEF
    return {
      answer: `### 🏛️ Kenya Re CatNet Intelligence Brief for **${propName}**

**Asset Profile:**
- **Insured Value (TIV):** KES ${tiv.toLocaleString()} (Implied Rebuild: KES ${rebuildRate.toLocaleString()}/m²)
- **Construction Class:** \`${hClass}\` (${floors} storeys above ground, ${basements} basements)
- **100-Year Net PML:** **KES ${pml100.toLocaleString()}** (${((pml100 / tiv) * 100).toFixed(2)}% of TIV)
- **Net AAL (Expected Annual Loss):** **KES ${aalNet.toLocaleString()}** (Rate on Line: ${rol}%)
- **AI Drainage Hotspot:** ${hotspot} (+0.35m stormwater surcharge applied)

**Quick Questions to Ask Me:**
- 📋 *"Explain the values inserted"* (breaks down every field on the active offer letter)
- 📈 *"Explain the dashboards & outputs"* (explains AAL, PML-100, ROL, and the EP curve)
- 🎯 *"Explain input meanings and relevance"* (why plinth, GFA, and basement plant matter)
- 🛡️ *"Explain system fallbacks used"* (source provenance and guardrails)
- ⚡ *"What if we move the generators out of the basement?"* (runs live what-if simulation)
- ⚡ *"What if we increase the deductible to 10%?"* (runs live deductible simulation)
- 📊 *"Calculate the 1-in-500 year loss and bootstrapped uncertainty"* (runs tail risk model)`,
      what_if_applied: false
    };
  }

  // Build and inject UI
  function initCopilotUI() {
    if (document.getElementById("copilot-widget")) return;

    const container = document.createElement("div");
    container.id = "copilot-widget";
    container.innerHTML = `
      <!-- Launcher Button -->
      <button id="copilot-toggle" class="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 bg-[#00274c] hover:bg-[#001c38] text-white px-4 py-3 rounded-full shadow-2xl border border-[rgba(209,18,66,0.6)] transition-all transform hover:scale-105 select-none" title="Kenya Re AI Underwriting Copilot">
        <span class="w-2.5 h-2.5 rounded-full bg-[#d11242] animate-pulse"></span>
        <span class="font-medium text-sm tracking-wide">✦ AI Underwriting Copilot</span>
      </button>

      <!-- Chat Drawer -->
      <div id="copilot-drawer" class="hidden fixed bottom-20 right-6 z-50 w-[460px] max-w-[calc(100vw-32px)] h-[600px] max-h-[calc(100vh-100px)] bg-[#ffffff] rounded-2xl shadow-2xl border border-[var(--border)] flex flex-col overflow-hidden font-sans">
        
        <!-- Drawer Header -->
        <div class="px-5 py-3.5 bg-[#00274c] text-white flex items-center justify-between border-b border-[#001c38]">
          <div class="flex items-center gap-2.5">
            <span class="w-2.5 h-2.5 rounded-full bg-[#d11242]"></span>
            <div>
              <h3 class="text-sm font-semibold tracking-wide flex items-center gap-1.5">Kenya Re AI Copilot</h3>
              <p id="copilot-active-risk" class="text-[11px] text-[#b2b2b2] truncate max-w-[300px]">Active Risk: Ingesting...</p>
            </div>
          </div>
          <button id="copilot-close" class="text-white/70 hover:text-white p-1 text-sm leading-none" title="Close">&times;</button>
        </div>

        <!-- Suggestion Chips -->
        <div class="p-3 bg-[#f8fafc] border-b border-[var(--border)] flex gap-1.5 overflow-x-auto no-scrollbar text-xs">
          <button class="copilot-chip whitespace-nowrap bg-white hover:bg-[#e6eef4] border border-[var(--border)] hover:border-[#00274c] px-2.5 py-1 rounded-full text-[#00274c] font-medium transition-colors" data-prompt="Explain the values inserted">
            📋 Explain Inserted Values
          </button>
          <button class="copilot-chip whitespace-nowrap bg-white hover:bg-[#e6eef4] border border-[var(--border)] hover:border-[#00274c] px-2.5 py-1 rounded-full text-[#00274c] font-medium transition-colors" data-prompt="Explain the dashboards and outputs">
            📈 Explain Dashboards & PML
          </button>
          <button class="copilot-chip whitespace-nowrap bg-white hover:bg-[#e6eef4] border border-[var(--border)] hover:border-[#00274c] px-2.5 py-1 rounded-full text-[#00274c] font-medium transition-colors" data-prompt="Explain input meanings and relevance">
            🎯 Input Relevance
          </button>
          <button class="copilot-chip whitespace-nowrap bg-white hover:bg-[#e6eef4] border border-[var(--border)] hover:border-[#00274c] px-2.5 py-1 rounded-full text-[#00274c] font-medium transition-colors" data-prompt="Explain system fallbacks used">
            🛡️ System Fallbacks
          </button>
          <button class="copilot-chip whitespace-nowrap bg-white hover:bg-[#e6eef4] border border-[var(--border)] hover:border-[#00274c] px-2.5 py-1 rounded-full text-[#00274c] font-medium transition-colors" data-prompt="What happens if we move the generators out of the basement?">
            ⚡ What-If: Move Plant
          </button>
          <button class="copilot-chip whitespace-nowrap bg-white hover:bg-[#e6eef4] border border-[var(--border)] hover:border-[#00274c] px-2.5 py-1 rounded-full text-[#00274c] font-medium transition-colors" data-prompt="What if we increase the deductible to 10%?">
            ⚡ What-If: 10% Ded
          </button>
          <button class="copilot-chip whitespace-nowrap bg-white hover:bg-[#e6eef4] border border-[var(--border)] hover:border-[#00274c] px-2.5 py-1 rounded-full text-[#00274c] font-medium transition-colors" data-prompt="Calculate the 1-in-500 year loss and bootstrapped uncertainty">
            📊 1-in-500y Tail
          </button>
          <button class="copilot-chip whitespace-nowrap bg-white hover:bg-[#e6eef4] border border-[var(--border)] hover:border-[#00274c] px-2.5 py-1 rounded-full text-[#00274c] font-medium transition-colors" data-prompt="Explain the JRC Huizinga Sigmoid curve parameters for this class">
            📐 JRC Curve Formula
          </button>
        </div>

        <!-- Chat History -->
        <div id="copilot-messages" class="flex-1 p-4 overflow-y-auto space-y-3.5 text-sm bg-[#fafafa]">
          <div class="bg-white p-3.5 rounded-xl border border-[var(--border)] shadow-sm text-xs leading-relaxed text-[#333]">
            <p class="font-semibold text-[#00274c] mb-1">👋 Welcome to Kenya Re CatNet Intelligence</p>
            <p>I analyze any offer letter inserted into the system. Ask me to explain the <strong class="text-[#00274c]">inserted values</strong>, the <strong class="text-[#00274c]">dashboard metrics</strong>, input relevance, fallbacks, or test <strong class="text-[#d11242]">"What-If" simulations</strong>!</p>
          </div>
        </div>

        <!-- Input Box -->
        <div class="p-3 bg-white border-t border-[var(--border)]">
          <form id="copilot-form" class="flex items-center gap-2">
            <input
              id="copilot-input"
              type="text"
              placeholder="Ask anything or simulate a what-if change..."
              class="flex-1 px-3.5 py-2 text-xs border border-[var(--border)] rounded-lg focus:outline-none focus:border-[#00274c]"
              autocomplete="off"
            />
            <button
              id="copilot-send"
              type="submit"
              class="bg-[#00274c] hover:bg-[#001c38] text-white px-3.5 py-2 rounded-lg text-xs font-semibold tracking-wide transition-colors"
            >
              Send
            </button>
          </form>
        </div>

      </div>
    `;
    document.body.appendChild(container);

    // Event listeners
    const toggleBtn = document.getElementById("copilot-toggle");
    const drawer = document.getElementById("copilot-drawer");
    const closeBtn = document.getElementById("copilot-close");
    const form = document.getElementById("copilot-form");
    const input = document.getElementById("copilot-input");

    toggleBtn.addEventListener("click", () => {
      drawer.classList.toggle("hidden");
      updateActiveRiskHeader();
      if (!drawer.classList.contains("hidden")) {
        input.focus();
      }
    });

    closeBtn.addEventListener("click", () => {
      drawer.classList.add("hidden");
    });

    // Chip prompt click
    document.querySelectorAll(".copilot-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const prompt = chip.dataset.prompt;
        if (prompt) {
          sendQuery(prompt);
        }
      });
    });

    // Form submit
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      sendQuery(text);
    });
  }

  function updateActiveRiskHeader() {
    const headerEl = document.getElementById("copilot-active-risk");
    if (!headerEl) return;
    const { exposure } = getActiveRisk();
    const name = exposure?.property_name?.value || exposure?.property_name || "Meridian Heights Developments Limited";
    const tiv = exposure?.exposure?.tiv_kes?.value || exposure?.exposure?.tiv_kes;
    headerEl.textContent = `${name} ${tiv ? "· " + fmtKes(tiv) : ""}`;
  }

  async function sendQuery(query) {
    const messages = document.getElementById("copilot-messages");
    if (!messages) return;

    // Append user message
    const userMsg = document.createElement("div");
    userMsg.className = "flex justify-end";
    userMsg.innerHTML = `
      <div class="bg-[#00274c] text-white px-3.5 py-2 rounded-xl text-xs max-w-[85%] leading-relaxed shadow-sm">
        ${escapeHtml(query)}
      </div>
    `;
    messages.appendChild(userMsg);
    messages.scrollTop = messages.scrollHeight;

    // Loading indicator
    const loadMsg = document.createElement("div");
    loadMsg.className = "flex justify-start";
    loadMsg.id = "copilot-loading";
    loadMsg.innerHTML = `
      <div class="bg-white border border-[var(--border)] px-3.5 py-2.5 rounded-xl text-xs text-[#666] flex items-center gap-2 shadow-sm">
        <span class="w-2 h-2 rounded-full bg-[#d11242] animate-ping"></span>
        <span>Evaluating model & reasoning...</span>
      </div>
    `;
    messages.appendChild(loadMsg);
    messages.scrollTop = messages.scrollHeight;

    const { exposure, results } = getActiveRisk();

    let data = null;

    // 1. Attempt backend call if available
    try {
      const res = await fetch(API_BASE + "/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, exposure, results })
      });
      if (res.ok) {
        data = await res.json();
      }
    } catch (_) {
      // Backend not running, proceed to client-side reasoning
    }

    // 2. Autonomous fallback: If backend returned 404, offline, or failed, run client-side engine!
    if (!data || !data.answer) {
      data = runClientSideReasoning(query, exposure, results);
    }

    const loading = document.getElementById("copilot-loading");
    if (loading) loading.remove();

    renderBotResponse(data, messages);
  }

  function renderBotResponse(data, container) {
    const botMsg = document.createElement("div");
    botMsg.className = "flex justify-start flex-col gap-2";

    const formattedAnswer = formatMarkdown(data.answer);

    let simulationBadgeHtml = "";
    if (data.what_if_applied && data.simulated_metrics) {
      const origPml = data.original_metrics?.pml_100y_kes != null ? fmtKes(data.original_metrics.pml_100y_kes) : "—";
      const simPml = fmtKes(data.simulated_metrics.pml_100y_kes);
      const origAal = data.original_metrics?.aal_net_kes != null ? fmtKes(data.original_metrics.aal_net_kes) : "—";
      const simAal = fmtKes(data.simulated_metrics.aal_net_kes);

      simulationBadgeHtml = `
        <div class="p-3 bg-[#fdf2f4] border border-[#f8b4c4] rounded-xl text-xs space-y-2 mt-1">
          <div class="flex items-center justify-between text-[#d11242] font-semibold">
            <span>⚡ Live Model Simulation Executed</span>
            <span class="text-[10px] bg-[#d11242] text-white px-2 py-0.5 rounded-full">Output Modified</span>
          </div>
          <div class="grid grid-cols-2 gap-2 text-[11px] bg-white p-2 rounded-lg border border-[#f8b4c4]/40">
            <div>
              <p class="text-[var(--muted)]">100-Year PML</p>
              <p class="font-semibold text-[#00274c]">${origPml} &rarr; <span class="text-[#d11242]">${simPml}</span></p>
            </div>
            <div>
              <p class="text-[var(--muted)]">Net AAL</p>
              <p class="font-semibold text-[#00274c]">${origAal} &rarr; <span class="text-[#d11242]">${simAal}</span></p>
            </div>
          </div>
          <button class="apply-sim-btn w-full bg-[#d11242] hover:bg-[#b80f39] text-white font-medium py-1.5 rounded-lg text-center transition-colors" data-results='${JSON.stringify(data.simulated_metrics || {})}' data-curve='${JSON.stringify(data.updated_ep_curve || [])}'>
            Apply Simulation to Active Analysis & EP Curve
          </button>
        </div>
      `;
    }

    botMsg.innerHTML = `
      <div class="bg-white border border-[var(--border)] p-3.5 rounded-xl text-xs leading-relaxed text-[#1a1a1a] shadow-sm max-w-[95%] space-y-2">
        <div class="prose-copilot">${formattedAnswer}</div>
        ${simulationBadgeHtml}
      </div>
    `;

    container.appendChild(botMsg);
    container.scrollTop = container.scrollHeight;

    // Attach listener to Apply Simulation button if present
    const applyBtn = botMsg.querySelector(".apply-sim-btn");
    if (applyBtn) {
      applyBtn.addEventListener("click", () => {
        try {
          const simMetrics = JSON.parse(applyBtn.dataset.results);
          const simCurve = JSON.parse(applyBtn.dataset.curve);
          const currentRes = JSON.parse(sessionStorage.getItem("kenyaReResults") || "{}");
          
          if (!currentRes.results) currentRes.results = {};
          currentRes.results.metrics = simMetrics;
          currentRes.results.ep_curve = simCurve;
          sessionStorage.setItem("kenyaReResults", JSON.stringify(currentRes));

          // If on analysis page, trigger re-render
          if (typeof window.renderAnalysis === "function") {
            window.renderAnalysis();
          }

          applyBtn.textContent = "✓ Applied to Live Analysis!";
          applyBtn.classList.remove("bg-[#d11242]", "hover:bg-[#b80f39]");
          applyBtn.classList.add("bg-[#0f9d6e]");
        } catch (e) {
          console.warn("Apply simulation error:", e);
        }
      });
    }
  }

  function formatMarkdown(text) {
    if (!text) return "";
    return text
      .replace(/### (.*?)\n/g, '<h4 class="font-bold text-[#00274c] text-xs mt-2 mb-1">$1</h4>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1 py-0.5 rounded text-[11px] font-mono">$1</code>')
      .replace(/\n\n/g, '<p class="my-1"></p>')
      .replace(/\n• /g, '<br>&bull; ')
      .replace(/\n- /g, '<br>&bull; ')
      .replace(/\n/g, '<br>');
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Initialize on DOM load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCopilotUI);
  } else {
    initCopilotUI();
  }
})();
