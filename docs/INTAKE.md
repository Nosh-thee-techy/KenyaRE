# Input layer — schema, fallbacks, coverage, construction

Smart ingestion: extract → lookup/derive → labelled default → ask the underwriter.

## Canonical fields

| Field | Type | Role |
|---|---|---|
| `lat`, `lon` | float | Sample hazard rasters |
| `elevation_m` | float | Terrain check (document or DEM) |
| `housing_class` | enum | Picks vulnerability curve and cost table |
| `height_m` | float | Storey estimate; not whole-building `d/H` for towers |
| `floors_above_ground` | int | Vertical split |
| `basement_floors` | int | Ingress / plant surcharge |
| `first_floor_height_m` | float | Depth relative to finished floor |
| `floor_area_m2` | float | GFA; wet-floor split |
| `typical_floor_m2` | float | `GFA / n_storeys` or class default |
| `cost_per_m2_kes` | float | Rebuild rate |
| `tiv_kes` | float | Declared sum insured (monetary anchor) |
| `occupancy` | enum | residential / commercial / industrial |
| `coverage_type` | string | As written on the slip |
| `class_of_business` | string | As written |
| `cover_subject` | enum | `building` \| `assets` \| `both` |
| `critical_plant_in_basement` | bool | Generators/chillers in B1/B2 |
| `deductible_pct`, `deductible_min_kes` | float | Cedant retains |
| `policy_limit_kes` | float | Payout ceiling |
| `source` | per field | See below |

Each scalar should be stored as `{ "value": …, "source": "…" }` or an equivalent sidecar so the UI can show origin.

`source` values: `extracted | geocoded | dem | implied | class_default | human`.

## Fallback order (locked)

Always try the document first.

| Field | Primary (document) | Fallback |
|---|---|---|
| GPS | Regex/NLP on lat/lon | Nominatim on street address; then interactive map pin. **Never invent.** Block the run if still missing or outside the Nairobi raster (lon &gt; 37.00 has no DEM tile). |
| Elevation | Stated ASL (e.g. 1,612 m) | Sample Copernicus GLO-30 at GPS. Do not ask a human to type metres. If both exist and differ by more than ~5 m, keep document as `elevation_m` and store DEM as `elevation_m_dem` with a flag. |
| Construction class | Construction / classification wording → four kit classes | Infer from implied KES/m² (`TIV/area` or stated cost). Else `permanent_masonry`. |
| Height | Stated roof/eaves height | `floors_above_ground × 3.5 m`. If floors missing: 1 storey for informal/semi; ask for RCC. |
| Basement | Count of B1, B2, … | `0` |
| Floor area | Gross floor area all levels | `TIV / cost_per_m2`; or `n_storeys × typical_floor_m2 + basements`. **Do not multiply an existing GFA by storey count.** |
| Cost per m² | Stated | Kit / Integrum 2025 class median |
| TIV | Declared sum | `area × cost_per_m2`, labelled estimated. If declared TIV conflicts with area × cost, **declared TIV wins**; keep implied cost/m² as a check. |
| Coverage type | `COVERAGE TYPE` / `Coverage:` line | Leave empty and ask — do not invent “All-Risks” |
| Cover subject | See [Coverage type](#coverage-type) | Synthetic CSV / silent slip → `building` |
| Deductible | Slip (`5% or KES 5,000,000 minimum`) | Synthetic book: `0`. Real slip: ask. Do not auto-apply Landmark’s 5%/5M to other risks. Apply `max(pct × ground_up, min_kes)` unless the clause says percent of TIV. |
| Limit | Slip | `100%` of TIV |

If geocode returns several hits, list them; the human picks. Nearby landmarks in the memo (Kibera 2.1 km from Landmark Plaza) are **not** the risk location.

## Coverage type

Extract the line as written, then infer subject of insurance.

### What the gold-sample slips actually say

**Landmark Plaza** (`test-data/OFFER_NAIROBI_LANDMARK_PLAZA.docx`):

- Class of business: `Commercial Property (Multi-Story Office & Retail)`
- Coverage type: `All-Risks (excluding flood) - flood cover available upon request`
- Insured interest: owner/lessor **and** occupying tenants
- Facultative flood: 5% or KES 5,000,000 minimum; limit = full TIV KES 1,090,000,000

**Nzoia grain** (`test-data/OFFER_NZOIA_GRAIN_PROCESSING.docx`):

- Class: `Industrial Property (Grain Processing)`
- Coverage: `All-Risks (excluding flood - facultative flood cover being requested)`
- Sought: All-Risks property KES 948,000,000 + facultative flood **capped** KES 250,000,000 + BI KES 5,000,000/month

Neither slip says “building only” or “contents only.” **All-Risks property** with a single TIV is treated as **both building and assets**, without doubling TIV. Tenant interest on Landmark does not create a second 1.09B.

Flood is a **separate election**: both current policies exclude flood; facultative flood is requested on top (full TIV in Nairobi, capped 250M in Nzoia).

### Inference rules

| Slip language | `cover_subject` |
|---|---|
| “building only”, “structure”, “PD building” | `building` |
| “contents”, “stock”, “plant only”, “machinery”, “FF&E” with no building sum | `assets` |
| “All-Risks”, “property”, building + contents/plant/stock, owner + tenants, one TIV | `both` |
| Synthetic CSV (`tiv_kes` is rebuild of structure; metadata: no contents, no land) | `building` |
| Unclear | Ask: building, assets, or both? |

Kit metadata: *“The values cover the structure only, not its contents or any land.”*

Problem statement example: a Kenyan business may insure **building and contents** against flood — that is the product concept, not the CSV.

If `both` and only one TIV: do not split unless a contents sum is stated. Optionally show a methodology note that commercial contents are often ~100% of structure in HAZUS/JRC, and that this TIV may already bundle them.

## Construction class

The engine only accepts the four kit labels:

`informal_iron_sheet` | `semi_permanent` | `permanent_masonry` | `concrete_rcc`

### Map from document wording (do this before any default)

**Landmark Plaza — one building, explicit heading:**

> CONSTRUCTION CLASSIFICATION: RCC Frame with Shear Walls (Grade A+)  
> Load-bearing walls constructed from reinforced concrete (M30 grade minimum)  
> Main structural system: Moment-resisting frame …

→ **`concrete_rcc`**. No fallback.

**Nzoia grain — several buildings, several lines:**

| Building in the slip | Wording | Map |
|---|---|---|
| Main processing | Reinforced concrete frame with corrugated iron roof and walls | `concrete_rcc` (note hybrid iron walls) |
| Warehouse 1 | Corrugated iron sheet walls, concrete base | `informal_iron_sheet` |
| Warehouse 2 | Mix of corrugated iron and concrete blocks | `semi_permanent` |
| Warehouse 3 | Corrugated iron sheets on timber frame | `informal_iron_sheet` |
| Office | Brick construction | `permanent_masonry` |

Nzoia is **per-location class**, not one class for the plant.

### If the construction line is missing

Infer from implied cost (KES/m²), then masonry:

| Implied KES/m² | Default class |
|---|---|
| &lt; 12,000 | `informal_iron_sheet` |
| 12,000–25,000 | `semi_permanent` |
| 25,000–60,000 | `permanent_masonry` |
| &gt; 60,000 | `concrete_rcc` |
| Nothing to infer | `permanent_masonry` (labelled `class_default`) |

Wrong class picks the wrong damage curve. Prefer asking on RCC-scale TIV if the text has no construction language.

## What to ask the human (blockers only)

1. No GPS after geocode → paste coordinates or drop a pin.  
2. No TIV and no (area + class/cost) → cannot value.  
3. Construction line missing and TIV/area cannot infer → pick one of four classes.  
4. Coverage type / subject unclear → building, assets, or both?  
5. Confirm derived GFA, storeys, or estimated TIV.

Do not open ten empty boxes.

## Landmark Plaza — expected parse

```json
{
  "property_name": "Landmark Plaza Commercial Development",
  "reference": "EIB-NAI-LP-2026-001",
  "coordinates": {
    "lat": { "value": -1.2847, "source": "extracted" },
    "lon": { "value": 36.8247, "source": "extracted" },
    "elevation_m": { "value": 1612.0, "source": "extracted" }
  },
  "exposure": {
    "housing_class": { "value": "concrete_rcc", "source": "extracted" },
    "occupancy": { "value": "commercial", "source": "derived" },
    "floor_area_m2": { "value": 24500.0, "source": "extracted" },
    "floors_above_ground": { "value": 18, "source": "extracted" },
    "total_height_m": { "value": 64.8, "source": "extracted" },
    "basement_floors": { "value": 2, "source": "extracted" },
    "first_floor_height_m": { "value": 1.0, "source": "class_default" },
    "critical_plant_in_basement": { "value": true, "source": "extracted" },
    "tiv_kes": { "value": 1090000000.0, "source": "extracted" },
    "cost_per_m2_kes": { "value": 44489.8, "source": "implied" }
  },
  "coverage": {
    "class_of_business": { "value": "Commercial Property (Multi-Story Office & Retail)", "source": "extracted" },
    "coverage_type": { "value": "All-Risks (excluding flood)", "source": "extracted" },
    "flood_cover_requested": { "value": true, "source": "extracted" },
    "cover_subject": { "value": "both", "source": "derived" },
    "insured_interest": ["owner/lessor", "occupying tenants"]
  },
  "financial_terms": {
    "deductible_pct": { "value": 0.05, "source": "extracted" },
    "deductible_min_kes": { "value": 5000000.0, "source": "extracted" },
    "policy_limit_kes": { "value": 1090000000.0, "source": "extracted" }
  }
}
```
