const schemaDescription = `{
  "property_name": "string | null",
  "reference": "string | null",
  "coordinates": { "lat": "number | null", "lon": "number | null", "elevation_m": "number | null", "source": "\"document_extracted\" | null" },
  "exposure": { "housing_class": "\"informal_iron_sheet\" | \"semi_permanent\" | \"permanent_masonry\" | \"concrete_rcc\" | null", "floor_area_m2": "number | null", "floors_above_ground": "number | null", "total_height_m": "number | null", "basement_floors": "number | null", "critical_plant_in_basement": "boolean | null", "tiv_kes": "number | null", "cost_per_m2_kes": "number | null" },
  "financial_terms": { "deductible_pct": "number | null", "deductible_min_kes": "number | null", "vital_considerations": "string[]" }
}`;

function extractionPrompt(context, validationError = "") {
  return `You are a strict document information extraction engine.
Extract only information explicitly supported by the supplied document context.
Never hallucinate, estimate, infer, or calculate missing fields. If a field cannot be verified, return null.
Return JSON matching this schema exactly:
${schemaDescription}

Normalize explicit values: percentages such as "5%" become 0.05; monetary values become numeric KES only when the document clearly identifies KES; preserve source precision.
Map housing descriptions only when confident: mabati/iron sheet informal -> informal_iron_sheet; semi-permanent -> semi_permanent; brick/block/stone masonry permanent -> permanent_masonry; reinforced concrete/RCC/concrete frame -> concrete_rcc.
Set coordinates.source to "document_extracted" only if at least one coordinate or elevation value is explicitly present in the document; otherwise null. Missing individual coordinate fields remain null.
vital_considerations must be a short array of underwriting considerations explicitly supported by the context, or [].
${validationError ? `A prior response failed validation: ${validationError}. Correct it and return the complete JSON object.` : ""}

DOCUMENT CONTEXT:
${context}`;
}

module.exports = { extractionPrompt };
