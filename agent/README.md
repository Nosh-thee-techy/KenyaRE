# Agent — smart ingestion

Document parser and fallback layer (module 0).

Reads a messy broker slip (DOCX/PDF/text), fills the canonical exposure JSON, then:

1. Extract from the document
2. Lookup / derive (Nominatim geocode, DEM elevation, `floors × 3.5 m`, `area × cost`)
3. Labelled default (basement `0`, limit = TIV)
4. Ask the underwriter only if the run is blocked (no GPS, no way to value)

Gold sample: `datasets and problem statements/test-data/OFFER_NAIROBI_LANDMARK_PLAZA.docx`

Schema and fallbacks: [docs/INTAKE.md](../docs/INTAKE.md).
