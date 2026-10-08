/**
 * Mock RAG / Deterministic Slip Parser (Module 0 Intake)
 * Extracts structured risk entities from unstructured broker placement slips.
 * Serves as the ground-truth pipeline for Landmark Plaza and provides
 * a seamless drop-in interface for Dev 1's LLM model.
 */

/**
 * Parses raw text from a reinsurance broker slip
 * @param {string} text - The raw text of the broker memorandum
 * @returns {Object} Extracted raw entity map
 */
function extractFromSlip(text = '') {
  const result = {};

  if (!text || typeof text !== 'string') {
    return result;
  }

  // 1. Client / Property Name
  const clientMatch = text.match(/CLIENT:\s*([^\r\n]+)/i);
  if (clientMatch) {
    result.property_name = clientMatch[1].replace(/\(.*?\)/g, '').trim();
  }

  // Reference number
  const refMatch = text.match(/REFERENCE:\s*([A-Z0-9\-]+)/i);
  if (refMatch) {
    result.reference = refMatch[1].trim();
  }

  // 2. GPS Coordinates (-1.2847°S, 36.8247°E or decimal -1.2847, 36.8247)
  const gpsMatch = text.match(/GPS COORDINATES:\s*([0-9\.\-]+)[°\s]*([NS])?,\s*([0-9\.\-]+)[°\s]*([EW])?/i);
  if (gpsMatch) {
    let lat = parseFloat(gpsMatch[1]);
    if (gpsMatch[2] && gpsMatch[2].toUpperCase() === 'S' && lat > 0) lat = -lat;
    let lon = parseFloat(gpsMatch[3]);
    if (gpsMatch[4] && gpsMatch[4].toUpperCase() === 'W' && lon > 0) lon = -lon;
    result.lat = lat;
    result.lon = lon;
  }

  // Address
  const addrMatch = text.match(/STREET ADDRESS:\s*([^\r\n]+)/i);
  if (addrMatch) {
    result.address = addrMatch[1].trim();
  }

  // Elevation
  const elevMatch = text.match(/ELEVATION:\s*([0-9,]+)\s*meters/i);
  if (elevMatch) {
    result.elevation_m = parseFloat(elevMatch[1].replace(/,/g, ''));
  }

  // 3. Construction Classification
  const constrMatch = text.match(/CONSTRUCTION CLASSIFICATION:\s*([^\r\n]+)/i);
  if (constrMatch) {
    const rawClass = constrMatch[1].toLowerCase();
    if (rawClass.includes('rcc') || rawClass.includes('reinforced concrete')) {
      result.housing_class = 'concrete_rcc';
    } else if (rawClass.includes('masonry') || rawClass.includes('brick') || rawClass.includes('stone')) {
      result.housing_class = 'permanent_masonry';
    } else if (rawClass.includes('semi-permanent') || rawClass.includes('timber')) {
      result.housing_class = 'semi_permanent';
    } else if (rawClass.includes('iron') || rawClass.includes('mabati')) {
      result.housing_class = 'informal_iron_sheet';
    }
  }

  // 4. Floors & Height
  const floorsMatch = text.match(/Total Number of Floors:\s*(\d+)/i);
  if (floorsMatch) {
    result.floors_above_ground = parseInt(floorsMatch[1], 10);
  }

  const heightMatch = text.match(/Building height \(to roof edge\):\s*([0-9\.]+)\s*meters/i);
  if (heightMatch) {
    result.total_height_m = parseFloat(heightMatch[1]);
  }

  // Basements
  const basementMatch = text.match(/(\d+)\s*\(basement\)/i) || text.match(/Basement Designation:\s*B1,\s*B2/i) || text.match(/two basement/i);
  if (basementMatch) {
    result.basement_floors = 2;
  }

  // Critical Plant in Basement check
  const lowerText = text.toLowerCase();
  const hasBasementPlant = 
    (lowerText.includes('generator') && (lowerText.includes('basement') || lowerText.includes('b1'))) ||
    (lowerText.includes('chiller') && (lowerText.includes('basement') || lowerText.includes('b2'))) ||
    (lowerText.includes('transformer') && (lowerText.includes('basement') || lowerText.includes('substation 1')));
  result.critical_plant_in_basement = hasBasementPlant;

  // 5. Floor Area (GFA)
  const gfaMatch = text.match(/GROSS FLOOR AREA:\s*([0-9,]+)\s*m²/i);
  if (gfaMatch) {
    result.floor_area_m2 = parseFloat(gfaMatch[1].replace(/,/g, ''));
  }

  // 6. Valuation (TIV)
  const tivMatch = text.match(/full TIV \(KES\s*([0-9,]+)\)/i) || text.match(/TIV:\s*KES\s*([0-9,]+)/i);
  if (tivMatch) {
    result.tiv_kes = parseFloat(tivMatch[1].replace(/,/g, ''));
  }

  // 7. Coverage & Subject
  const covMatch = text.match(/COVERAGE TYPE:\s*([^\r\n]+)/i);
  if (covMatch) {
    result.coverage_type = covMatch[1].trim();
  }

  const cobMatch = text.match(/CLASS OF BUSINESS:\s*([^\r\n]+)/i);
  if (cobMatch) {
    result.class_of_business = cobMatch[1].trim();
  }

  result.flood_cover_requested = lowerText.includes('flood cover') || lowerText.includes('facultative flood');

  // 8. Deductible & Policy Limit
  const dedMatch = text.match(/(\d+)%\s*deductible or KES\s*([0-9,]+)\s*minimum/i);
  if (dedMatch) {
    result.deductible_pct = parseFloat(dedMatch[1]) / 100.0;
    result.deductible_min_kes = parseFloat(dedMatch[2].replace(/,/g, ''));
  }

  if (result.tiv_kes) {
    result.policy_limit_kes = result.tiv_kes;
  }

  return result;
}

module.exports = {
  extractFromSlip
};
