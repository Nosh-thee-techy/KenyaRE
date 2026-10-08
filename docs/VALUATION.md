# Valuation

Replacement cost to rebuild, in Kenyan shillings. Not market price, not land, not book value.

## Identity

```
structure_tiv = floor_area_m2 × cost_per_m2_kes
```

If the slip states a sum insured, **that TIV wins**. `area × cost` stays as a rebuild check (Landmark: 1.09B / 24,500 m² ≈ KES 44,490/m², below the kit RCC median — normal for a policy sum).

## Kenya cost table (starter kit)

From `exposure_nairobi_with_hazard.csv` and `Dataset_Metadata.docx` (Integrum-style 2025 construction guides). Structure only.

| Class | Typical GFA | Cost / m² (KES) | Median TIV in kit |
|---|---|---|---|
| `informal_iron_sheet` | 8–28 m² (typ. 14) | 5,100–10,000 | ~KES 1.05M |
| `semi_permanent` | 20–80 m² (typ. 38) | 8,000–16,000 | ~KES 4.48M |
| `permanent_masonry` | 45–218 m² (typ. 99) | 35,300–64,700 | ~KES 48.8M |
| `concrete_rcc` | 250–2,793 m² (typ. 768) | 55,900–84,800 | ~KES 539M |

Book total: **KES 63.6B** across 600 synthetic buildings. RCC is 84 locations (14%) and **85%** of TIV.

Do not use US HAZUS $/ft² or JRC 2010 EUR/m² as the Kenyan TIV. JRC is for **damage ratios**, not the sum insured.

## Floor size

Two jobs: fill missing GFA, and stop a shallow flood damaging an entire tower.

```
GFA ≈ (floors_above_ground × typical_floor_m2) + (basement_floors × basement_floor_m2)
```

If GFA is already stated, `typical_floor_m2 = GFA / n_storeys`. Never GFA × storeys.

Class defaults when plate is unknown: informal 14 m² (the dwelling is one floor); semi-permanent 38 m²; masonry ~100 m² bungalow or ~50 m² × 2; RCC office 400–1,500 m² (Landmark typical office floor **1,280 m²**).

Landmark check: 16 × 1,280 + 2,150 + 1,850 + 2 × 2,100 = **24,500 m²** (matches the offer).

### Wet-storey split (required for RCC)

```
loss = damage_ratio × (wet_floor_area × cost_per_m2)
```

plus contents on those floors if `cover_subject` includes assets, plus a plant surcharge if `critical_plant_in_basement`.

Illustration at 1 m (not a measured Upper Hill depth):

| Level | Area m² | In a 1 m flood? |
|---|---|---|
| B2 | 2,100 | Yes (5.2 m below grade) |
| B1 | 2,100 | Yes (2.5 m below grade) |
| Ground | 2,150 | Only if depth ≥ first-floor height |
| Mezzanine + F2–F17 | 18,150 | No |

40% × full 1.09B ≈ KES 436M (wrong). 40% × wet ~26% of GFA ≈ KES 113M (right order of magnitude). `damage_ratio = depth / height` (1 / 64.8 ≈ 1.5%) is also wrong once generators and chillers sit in B1.

One-storey iron-sheet: floor size = GFA; split changes nothing.

## Contents / assets

HAZUS / Huizinga contents as a fraction of structure, if we need to split a “both” cover that has no contents sum:

| Occupancy | Contents ratio |
|---|---|
| Residential | 50% |
| Commercial | 100% |
| Industrial | 150% |

Synthetic CSV: contents = N/A (structure only). Parsed All-Risks with one TIV: treat as bundled **both**, do not add 100% on top of declared TIV.

Do not depreciate TIV. Insurance pays rebuild of a new equivalent. Undamageable fraction (JRC: concrete/masonry ~0.40, informal ~0) belongs in the **curve ceiling**, not as a haircut to the sum insured.

## Financial terms

```
ground_up = damage_ratio × insured_wet_value
gross     = min(max(ground_up − deductible, 0), limit)
deductible = max(deductible_pct × ground_up, deductible_min_kes)
```

Optional quota share: `ceded = qs × gross`, `net = gross − ceded`. Treaty XL is out of scope.

Landmark flood clause: 5% or KES 5,000,000 **minimum** → `max(0.05 × loss, 5_000_000)`. Nzoia suggested flood deductible KES 15,000,000 and flood **limit 250M** (not full 948M TIV).
