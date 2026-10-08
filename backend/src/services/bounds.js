/**
 * Nairobi Geospatial Bounding Box & Raster Coverage Validator
 * Reference: docs/INTAKE.md and Dataset_Metadata.docx
 */

const NAIROBI_BOUNDS = Object.freeze({
  min_lat: -1.45,
  max_lat: -1.10,
  min_lon: 36.60,
  max_lon: 37.05,
  raster_max_lon: 37.00 // Copernicus tile cuts off at 37.00
});

/**
 * Validates whether GPS coordinates fall inside the modeled Nairobi region
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {{isValid: boolean, isWithinRaster: boolean, error?: string, warning?: string}}
 */
function validateNairobiCoordinates(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
    return {
      isValid: false,
      isWithinRaster: false,
      error: 'Invalid coordinates: lat and lon must be valid numbers.'
    };
  }

  // Check overall Nairobi Metropolitan Bounds
  if (lat < NAIROBI_BOUNDS.min_lat || lat > NAIROBI_BOUNDS.max_lat) {
    return {
      isValid: false,
      isWithinRaster: false,
      error: `Latitude ${lat} is outside Nairobi coverage [${NAIROBI_BOUNDS.min_lat}, ${NAIROBI_BOUNDS.max_lat}].`
    };
  }

  if (lon < NAIROBI_BOUNDS.min_lon || lon > NAIROBI_BOUNDS.max_lon) {
    return {
      isValid: false,
      isWithinRaster: false,
      error: `Longitude ${lon} is outside Nairobi coverage [${NAIROBI_BOUNDS.min_lon}, ${NAIROBI_BOUNDS.max_lon}].`
    };
  }

  // Check Copernicus GLO-30 raster tile cut-off at 37.00
  if (lon > NAIROBI_BOUNDS.raster_max_lon) {
    return {
      isValid: true,
      isWithinRaster: false,
      warning: `Longitude ${lon} is east of 37.00°. The Copernicus GLO-30 DEM tile ends at 37.00° (no raster hazard data in the 37.00°–37.05° strip).`
    };
  }

  return {
    isValid: true,
    isWithinRaster: true
  };
}

module.exports = {
  NAIROBI_BOUNDS,
  validateNairobiCoordinates
};
