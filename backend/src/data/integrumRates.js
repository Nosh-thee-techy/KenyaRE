/**
 * Official Kenya Rebuild Cost Rates & Structural Parameters (2025 Integrum Construction Guides)
 * Source: Dataset_Metadata.docx and docs/VALUATION.md
 */

const INTEGRUM_2025_RATES = Object.freeze({
  informal_iron_sheet: {
    label: "Informal Iron Sheet (Mabati)",
    min_cost_m2: 5100,
    median_cost_m2: 7800,
    max_cost_m2: 10000,
    typical_area_m2: 14,
    default_floors: 1,
    floor_height_m: 2.5,
    default_plinth_m: 0.15,
    damage_ceiling_K: 0.85
  },
  semi_permanent: {
    label: "Semi-Permanent (Timber / Mud Plaster / Brick)",
    min_cost_m2: 8000,
    median_cost_m2: 12500,
    max_cost_m2: 16000,
    typical_area_m2: 38,
    default_floors: 1,
    floor_height_m: 3.0,
    default_plinth_m: 0.25,
    damage_ceiling_K: 0.70
  },
  permanent_masonry: {
    label: "Permanent Masonry (Quarry Stone / Bungalow)",
    min_cost_m2: 35300,
    median_cost_m2: 48000,
    max_cost_m2: 64700,
    typical_area_m2: 99,
    default_floors: 1,
    floor_height_m: 3.5,
    default_plinth_m: 0.45,
    damage_ceiling_K: 0.50
  },
  concrete_rcc: {
    label: "Reinforced Concrete Frame (RCC / Commercial Tower)",
    min_cost_m2: 55900,
    median_cost_m2: 70000,
    max_cost_m2: 84800,
    typical_area_m2: 768,
    default_floors: 4,
    floor_height_m: 3.8,
    default_plinth_m: 1.0,
    damage_ceiling_K: 0.35
  }
});

/**
 * Infer construction class from implied cost per square meter
 * (Rule per docs/INTAKE.md: <12k informal, 12k-25k semi, 25k-60k masonry, >60k RCC)
 * @param {number} costPerM2 - Rebuild cost in KES/m²
 * @returns {string} One of the 4 canonical classes
 */
function inferClassFromCost(costPerM2) {
  if (!costPerM2 || costPerM2 <= 0) return 'permanent_masonry';
  if (costPerM2 < 12000) return 'informal_iron_sheet';
  if (costPerM2 < 25000) return 'semi_permanent';
  if (costPerM2 <= 60000) return 'permanent_masonry';
  return 'concrete_rcc';
}

module.exports = {
  INTEGRUM_2025_RATES,
  inferClassFromCost
};
