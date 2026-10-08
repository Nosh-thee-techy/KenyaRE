# Frontend — underwriting intake cockpit

Static HTML/Tailwind/Leaflet app. No build step.

```
frontend/public/
  index.html          intake
  analysis.html       overview shell for later CAT results
  brand/              Kenya Re lockup, mark, banner, favicon
  css/style.css
  js/app.js
  js/mapModal.js
  js/mockData.js
  data/sample_placement_slip.txt
```

## Run locally

```bash
cd frontend/public
python -m http.server 5173
```

Open http://127.0.0.1:5173

Brand: Kenya Re navy `#00274c` and crimson `#d11242` from `brand/`.

## Day-1 flow (API optional)

1. **Load Landmark Plaza demo** — fills the slip textarea.
2. **Extract risk profile** — `POST /api/intake/parse-slip`; if the backend is down, applies the fixture in `js/mockData.js` (`docs/INTAKE.md`).
3. Edit any field — source tag becomes `human`.
4. **Pinpoint on Nairobi map** if GPS is missing. Address search uses `/api/intake/geocode`, then public Nominatim.
5. **Run catastrophe model** — `POST /api/model/run`; if offline, shows the handoff JSON.

GPS is never invented. Ready state requires coordinates inside the Nairobi raster (lon 36.60–37.00, lat −1.45 to −1.10), a construction class, and TIV or GFA.
