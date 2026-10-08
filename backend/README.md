# Backend — catastrophe engine

Python service for modules 1–4 of the Nairobi flood CAT model:

1. **Hazard** — sample pluvial proxy rasters (or pre-joined CSV scores) at a lat/lon
2. **Vulnerability** — class-specific damage curves (JRC Huizinga adapted)
3. **Exposure** — synthetic book + parsed facultative JSON
4. **Financial** — deductible / limit → ground-up, gross, EP curve, AAL, PML

Does not parse broker slips. That is the [agent](../agent/). Serves JSON to the [frontend](../frontend/).

See [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).
