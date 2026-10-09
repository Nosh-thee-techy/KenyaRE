const { gatePin } = require("./hotspots");
const { buildEvidencePack } = require("./evidencePack");

const AI_SCORE_ADD = 0.28;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function hasDrainageEvidence(pack, hotspotName) {
  const name = String(hotspotName || "").toLowerCase();
  return (pack.rows || []).some((row) => {
    if (row.mechanism !== "drainage") return false;
    if (!name) return true;
    return String(row.hotspot_name || "").toLowerCase() === name;
  });
}

function briefing({ applied, gate, pack, nearest }) {
  const bits = [];
  bits.push(
    `TIFF proxy check: ${gate.hit_count} of 24 named hotspots are visible; ${gate.blinded_count} are blinded (nodata or score < ${gate.blind_score_max}). Source: ${gate.classification_source}.`
  );
  if (nearest) {
    bits.push(
      `Nearest blinded corridor is ${nearest.name} at ${nearest.distance_km} km (gate radius ${gate.radius_km} km).`
    );
  } else {
    bits.push("No blinded hotspot is on file for this pin.");
  }
  if (applied) {
    bits.push(
      `AI upgrade applied: susceptibility +${AI_SCORE_ADD} on the blinded drainage miss, then the same JRC curve and policy terms. That changes AAL and the EP curve.`
    );
  } else if (gate.in_blind_radius && !hasDrainageEvidence(pack, nearest && nearest.name)) {
    bits.push("Pin is inside the radius but no drainage-mechanism row was extracted, so the loss is unchanged.");
  } else {
    bits.push("Pin is outside a blinded drainage corridor, so AI-upgraded loss equals base loss.");
  }
  if (pack.osm && pack.osm.status === "ok") {
    bits.push(`OSM waterway/culvert count within ${pack.osm.radius_m} m: ${pack.osm.waterway_or_culvert_count}.`);
  } else if (pack.osm) {
    bits.push(`OSM drain density was not available (${pack.osm.reason || pack.osm.status}).`);
  }
  bits.push("News is not a gauge.");
  return bits.join(" ");
}

function assumptions({ applied, gate }) {
  return [
    "GeoTIFF cells are 0–1 susceptibility scores, not measured depth.",
    "Depth = Hmax(storm) × score. Hmax is the engine wet-cell ceiling, not a road gauge.",
    `A named hotspot is blinded when common/extreme samples are nodata or max score < ${gate.blind_score_max}. If rasters are missing, kit-named misses (Kibera, Westlands, Lavington, Kitisuru) are used and the rest stay unclassified.`,
    `Upgrade radius is ${gate.radius_km} km from a blinded hotspot.`,
    `When the upgrade fires, susceptibility_ai = min(1, (base score or 0) + ${AI_SCORE_ADD}). Nodata is treated as 0 on the AI layer only — Hazard still shows the real TIFF status.`,
    "Upgrade fires only with a drainage-mechanism row from the allowlist (or Gemini quoting that allowlist).",
    "JRC / Huizinga shape is adapted, not locally calibrated.",
    "Facultative slip is a single risk, not the 600-row synthetic book.",
    applied
      ? "AI-upgraded AAL is the underwriting number on Finance; Hazard / Vulnerability / Exposure stay on the unadjusted TIFF."
      : "AI-upgraded loss equals base loss on this pin."
  ];
}

function attachUpgradePayload(result, payload) {
  result.ai_upgrade = payload.ai_upgrade;
  result.ai_ep_curve = payload.ai_ep_curve;
  result.ai_metrics = payload.ai_metrics;
  result.ai_loss_per_tier = payload.ai_loss_per_tier;
  result.hazard_summary = {
    ...(result.hazard_summary || {}),
    nearby_hotspot: payload.nearest_name,
    nearby_hotspot_class: payload.nearest_class,
    score_source: "hazard_book",
    score_distance_km: payload.distance_km,
    depth_method: result.model && result.model.depth_method,
    ai_upgrade_applied: payload.ai_upgrade.applied
  };
  if (result.model && Array.isArray(result.model.assumptions)) {
    result.model.assumptions = result.model.assumptions.concat(
      payload.ai_upgrade.assumptions.slice(2, 6)
    );
  }
  return result;
}

async function attachAiUpgrade(result, ctx, deps) {
  const { sampleSusceptibility, priceScenarios, summarizeMetrics } = deps;
  const lat = ctx.lat;
  const lon = ctx.lon;
  const emptyUpgrade = {
    applied: false,
    reason: "missing_coordinates",
    surcharge: { type: "susceptibility_add", value: AI_SCORE_ADD },
    sources: [],
    rows: [],
    assumptions: assumptions({ applied: false, gate: { blind_score_max: 0.08, radius_km: 2 } }),
    briefing: "Coordinates are required before the 24-hotspot gate can run."
  };

  if (lat == null || lon == null) {
    return attachUpgradePayload(result, {
      ai_upgrade: emptyUpgrade,
      ai_ep_curve: result.ep_curve,
      ai_metrics: result.metrics,
      ai_loss_per_tier: result.base_loss_per_tier,
      nearest_name: null,
      nearest_class: null,
      distance_km: null
    });
  }

  const gate = await gatePin(lat, lon, sampleSusceptibility);
  const nearest = gate.nearest_blinded;
  const pack = await buildEvidencePack({
    hotspotName: nearest && nearest.name,
    lat,
    lon,
    apiKey: process.env.GEMINI_API_KEY
  });
  const drainage = hasDrainageEvidence(pack, nearest && nearest.name);
  const applied = Boolean(gate.in_blind_radius && drainage);

  let aiScenarios = result.scenarios;
  if (applied) {
    const upgradedHazard = (result.scenarios || []).map((scenario) => {
      const base = scenario.susceptibility_score != null ? scenario.susceptibility_score : scenario.susceptibility;
      const baseScore = base == null ? 0 : base;
      const aiScore = Math.min(1, Math.max(0, baseScore + AI_SCORE_ADD));
      const hmax = scenario.assumed_max_depth_m;
      const depth = hmax == null ? null : round2(aiScore * hmax);
      return {
        ...scenario,
        susceptibility: aiScore,
        susceptibility_score: aiScore,
        susceptibility_base: base,
        estimated_depth_m: depth,
        flood_depth_m: depth,
        depth_method: `AI-upgraded score (${base == null ? "nodata→0" : base} + ${AI_SCORE_ADD}) × ${hmax} m tier maximum`,
        status: "ok"
      };
    });
    aiScenarios = priceScenarios(upgradedHazard, ctx);
  }

  const aiSummary = summarizeMetrics(aiScenarios, ctx.tiv);
  const payload = {
    applied,
    reason: applied
      ? "blinded_drainage_corridor"
      : gate.in_blind_radius
        ? "no_drainage_evidence"
        : "outside_blind_radius",
    radius_km: gate.radius_km,
    surcharge: { type: "susceptibility_add", value: AI_SCORE_ADD, unit: "susceptibility_score" },
    classification_source: gate.classification_source,
    blinded_count: gate.blinded_count,
    hit_count: gate.hit_count,
    nearest_blinded: nearest,
    nearest_hotspot: gate.nearest_hotspot,
    drainage_evidence: drainage,
    evidence: pack,
    sources: pack.sources,
    assumptions: assumptions({ applied, gate }),
    briefing: briefing({ applied, gate, pack, nearest })
  };

  return attachUpgradePayload(result, {
    ai_upgrade: payload,
    ai_ep_curve: aiScenarios,
    ai_metrics: aiSummary.metrics,
    ai_loss_per_tier: aiSummary.per_tier,
    nearest_name: nearest && nearest.name,
    nearest_class: nearest && nearest.class,
    distance_km: nearest && nearest.distance_km
  });
}

module.exports = { attachAiUpgrade, AI_SCORE_ADD };
