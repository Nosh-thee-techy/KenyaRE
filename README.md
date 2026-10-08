# Kenya Re — Nairobi Flood Catastrophe Model

Team A (Nairobi track) of the Flood Risk Intelligence Challenge.

This repository will hold an underwriter-facing **flood catastrophe model** for Nairobi: not a flood map and not a chatbot. It turns a messy broker slip (or the synthetic 600-building book) into a loss number and an exceedance-probability (EP) curve.

**Status:** design locked. Parser and engine are not built yet.

## Repository layout

| Folder | Responsibility |
|---|---|
| [`agent/`](agent/) | Smart ingestion — parse broker slips, geocode, DEM lookup, ask the underwriter |
| [`backend/`](backend/) | Cat engine — hazard, vulnerability, exposure, financial, EP curve |
| [`frontend/`](frontend/) | Underwriter UI |
| [`docs/`](docs/) | Architecture, intake schema, valuation |
| [`datasets and problem statements/`](datasets%20and%20problem%20statements/) | Hackathon starter kit (do not treat synthetic files as real portfolios) |

## What we are building

Kenya Re currently prices East African flood with underwriter judgement and coarse global layers. Licensed RMS/Verisk models exist but sit on proprietary claims we cannot use. This prototype is the open-data version of that job, for **Nairobi pluvial (surface-water) flooding**.

Every commercial cat model is the same four modules. We implement all four, then an AI **smart ingestion layer** that must change a number (parse a slip into exposure), not only caption a chart.

```
Broker slip / synthetic CSV
            │
            ▼
   ┌─────────────────────┐
   │  0. Input layer     │  extract → lookup/derive → labelled default → ask human
   └──────────┬──────────┘
              ▼
   Hazard → Vulnerability → Exposure → Financial
              ▼
   EP curve, AAL, PML, class split, methodology tags
```

Full design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Locked intake rules (short)

Document first. Then the fallback. Tag every field’s source. GPS is never invented.

| Field | From the document | If unfound |
|---|---|---|
| GPS | Lat/lon in the slip | Geocode address (OSM Nominatim); if still unknown, human drops a pin |
| Elevation | Stated metres ASL | Copernicus GLO-30 DEM at the GPS |
| Construction class | Construction / classification line, mapped to four kit classes | Infer from TIV/m²; else `permanent_masonry` |
| Height | Stated height (m) | `floors × 3.5 m` |
| Basement | Stated count (B1, B2…) | `0` |
| Floor area | Gross floor area | `TIV / cost_per_m²`, or storeys × typical floor plate |
| Cost per m² | Stated | Integrum 2025 / kit class table |
| TIV | Declared sum insured | `area × cost_per_m²` (labelled estimated) |
| Coverage type | `COVERAGE TYPE` / class of business as written | — |
| Subject of insurance | All-Risks property with one TIV → building **and** assets | Silent / synthetic CSV → **building only** |
| Deductible | Slip clause (`max(pct × loss, min KES)`) | `0` on the synthetic book; ask on a real slip |
| Limit | Slip clause | `100%` of TIV |

Details and Landmark / Nzoia wording: [docs/INTAKE.md](docs/INTAKE.md).  
Valuation (replacement cost, floor split, contents): [docs/VALUATION.md](docs/VALUATION.md).

## Nairobi-specific trap

There is **no public flood-depth map** for Nairobi. Hazard is a 0–1 terrain/river **proxy**, not metres of water.

A rarer flood covers more ground, so:

- `common` (widest, top 40% of cells) → rarest event (reference: 250-year)
- `extreme` (narrowest, top 5%) → most frequent (reference: 10-year)

The proxy flags 12 of 24 geocoded county hotspots (Eastlands river valleys). It misses drainage-driven floods (Kibera, Westlands, Lavington, …). That is a known limit. Do not treat “347 m above Nairobi River” as proof the site is dry: Nairobi’s peril is **pluvial**, not only river overflow.

## Data (starter kit)

Unpacked from `OneDrive_2026-10-08.zip` into `datasets and problem statements/`.

| Path | What it is |
|---|---|
| `data/team_a_nairobi/exposure_nairobi_with_hazard.csv` | **Start here.** 600 synthetic buildings + five hazard scores |
| `data/team_a_nairobi/nairobi_pluvial_proxy_*.tif` | Five susceptibility rasters (0–1), ~31 m |
| `data/team_a_nairobi/nairobi_hotspots_geocoded.csv` | 24 of 37 county-named flood areas |
| `test-data/OFFER_NAIROBI_LANDMARK_PLAZA.docx` | Gold-sample broker memo for the AI parser |
| `test-data/OFFER_NZOIA_GRAIN_PROCESSING.docx` | Team B equivalent (multi-building, mixed class) |

The 600-row book is **fully synthetic**, structure-only TIV, **KES 63.6 billion**. RCC is 14% of count and **85%** of value. Always label synthetic in the UI.

Team B (Nzoia) uses real JRC depth rasters. We are Team A unless that changes.

## Test object — Landmark Plaza

When the parser reads the Nairobi offer it must produce (sources tagged):

- GPS −1.2847, 36.8247 (extracted); elevation 1,612 m (extracted) or DEM if that line were missing
- `housing_class`: `concrete_rcc` from **“CONSTRUCTION CLASSIFICATION: RCC Frame with Shear Walls (Grade A+)”**
- 18 floors + 2 basements; height 64.8 m; GFA 24,500 m²
- `coverage_type`: All-Risks (excluding flood); flood optional at full TIV KES 1.09B
- Deductible 5% or KES 5,000,000 minimum; limit = TIV
- Subject: All-Risks commercial property, owner **and** tenants → both building and assets, **one** TIV (do not double 1.09B)

A 1 m flood must **not** apply 40% to the whole tower. Split TIV by wet storeys (B2 + B1 + maybe ground) plus basement plant.

## Out of scope

- Real Kenya Re policies, claims, or portfolios
- RMS / Verisk / JBA / Fathom licensed data
- Full treaty layering / cat XL programmes
- Full physically based pluvial hydrology (stretch only)
- Coding the parser or engine until design is signed off (this folder is documentation)

## Documentation map

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, module I/O, outputs, AI requirement |
| [docs/INTAKE.md](docs/INTAKE.md) | Input layer, fallbacks, coverage type, construction mapping |
| [docs/VALUATION.md](docs/VALUATION.md) | Replacement cost, Kenya rates, floor-size split, financial terms |

Hackathon originals (do not edit): `datasets and problem statements/Team_A_Nairobi_Problem_Statement.docx`, `STEP_BY_STEP_GUIDE.md`, `Dataset_Metadata.docx`.
