const { z } = require("zod");

const nullableNumber = z.number().finite().nullable();
const housingClasses = [
  "informal_iron_sheet",
  "semi_permanent",
  "permanent_masonry",
  "concrete_rcc"
];

const exposureSchema = z.object({
  property_name: z.string().nullable(),
  reference: z.string().nullable(),
  address: z.string().nullable().optional(),
  occupancy: z.string().nullable().optional(),
  class_of_business: z.string().nullable().optional(),
  coverage_type: z.string().nullable().optional(),
  flood_cover_requested: z.boolean().nullable().optional(),
  coordinates: z.object({
    lat: nullableNumber,
    lon: nullableNumber,
    elevation_m: nullableNumber,
    source: z.literal("document_extracted").nullable()
  }),
  exposure: z.object({
    housing_class: z.enum(housingClasses).nullable(),
    floor_area_m2: nullableNumber,
    floors_above_ground: nullableNumber,
    total_height_m: nullableNumber,
    basement_floors: nullableNumber,
    first_floor_height_m: nullableNumber.optional(),
    critical_plant_in_basement: z.boolean().nullable(),
    tiv_kes: nullableNumber,
    cost_per_m2_kes: nullableNumber
  }),
  financial_terms: z.object({
    deductible_pct: nullableNumber,
    deductible_min_kes: nullableNumber,
    policy_limit_kes: nullableNumber.optional(),
    vital_considerations: z.array(z.string())
  })
});

const emptyExtraction = {
  property_name: null,
  reference: null,
  address: null,
  occupancy: null,
  class_of_business: null,
  coverage_type: null,
  flood_cover_requested: null,
  coordinates: { lat: null, lon: null, elevation_m: null, source: null },
  exposure: {
    housing_class: null,
    floor_area_m2: null,
    floors_above_ground: null,
    total_height_m: null,
    basement_floors: null,
    first_floor_height_m: null,
    critical_plant_in_basement: null,
    tiv_kes: null,
    cost_per_m2_kes: null
  },
  financial_terms: {
    deductible_pct: null,
    deductible_min_kes: null,
    policy_limit_kes: null,
    vital_considerations: []
  }
};

module.exports = { exposureSchema, emptyExtraction, housingClasses };
