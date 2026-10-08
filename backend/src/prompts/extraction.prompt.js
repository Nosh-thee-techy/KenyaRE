const schemaDescription = `{
  "property_name": "string | null",
  "reference": "string | null",
  "address": "string | null",
  "occupancy": "string | null",
  "class_of_business": "string | null",
  "coverage_type": "string | null",
  "flood_cover_requested": "boolean | null",
  "coordinates": { "lat": "number | null", "lon": "number | null", "elevation_m": "number | null", "source": "\\"document_extracted\\" | null" },
  "exposure": { "housing_class": "\\"informal_iron_sheet\\" | \\"semi_permanent\\" | \\"permanent_masonry\\" | \\"concrete_rcc\\" | null", "floor_area_m2": "number | null", "floors_above_ground": "number | null", "total_height_m": "number | null", "basement_floors": "number | null", "first_floor_height_m": "number | null", "critical_plant_in_basement": "boolean | null", "tiv_kes": "number | null", "cost_per_m2_kes": "number | null" },
  "financial_terms": { "deductible_pct": "number | null", "deductible_min_kes": "number | null", "policy_limit_kes": "number | null", "vital_considerations": "string[]" }
}`;

function extractionPrompt(context, validationError = "") {
  return `You are a strict document information extraction engine.
Extract only information explicitly supported by the supplied document context (text and/or page images).
Never hallucinate, estimate, infer, or calculate missing fields. If a field cannot be verified, return null.
Return JSON matching this schema exactly:
${schemaDescription}

Normalize explicit values: percentages such as "5%" become 0.05; monetary values become numeric KES only when the document clearly identifies KES, KSh, Ksh, or Kenya Shillings (expand billions/millions); preserve source precision.
Map tiv_kes from Sum Insured, Total Sum Insured, Sums Insured, SI, TSI, Declared Value, or TIV when an amount is written. Never calculate, estimate, or fill tiv_kes from floor area or a rebuild cost table. If no declared sum is written, tiv_kes is null.
Map address from Street Address, Risk Location, Situation, Situated at, Location, or Address lines. Do not use a nearby landmark as the risk address.
Map housing descriptions only when confident: mabati/iron sheet informal -> informal_iron_sheet; semi-permanent -> semi_permanent; brick/block/stone masonry permanent -> permanent_masonry; reinforced concrete/RCC/concrete frame -> concrete_rcc. If construction wording is absent or unclear, housing_class is null — do not default to masonry.
Map floor_area_m2 from GFA, gross floor area, built-up area, or floor area in m² / sqm / square metres. Do not invent GFA.
Map floors_above_ground from storeys/floors/G+N (G+17 means 18). Leave null if unstated.
Map total_height_m and first_floor_height_m / plinth only when metres are written. Never compute height from storeys.
GPS: extract latitude/longitude only if printed (including DMS). Never geocode or invent coordinates. Missing GPS fields stay null.
Set coordinates.source to "document_extracted" only if at least one coordinate or elevation value is explicitly present in the document; otherwise null.
flood_cover_requested is true only if facultative flood / flood cover is requested; false only if flood is explicitly not sought; otherwise null.
vital_considerations must be a short array of underwriting considerations explicitly supported by the context, or [].
${validationError ? `A prior response failed validation: ${validationError}. Correct it and return the complete JSON object.` : ""}

DOCUMENT CONTEXT:
${context}`;
}

module.exports = { extractionPrompt };
