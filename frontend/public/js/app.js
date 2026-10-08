(function () {
  const CLASS_LABELS = {
    concrete_rcc: "RCC frame",
    permanent_masonry: "Stone / brick",
    semi_permanent: "Timber / mud plaster",
    informal_iron_sheet: "Mabati",
  };

  const COVER_LABELS = {
    building: "Building only",
    assets: "Assets only",
    both: "Building + assets",
  };

  const EXTRACT_URL = "http://127.0.0.1:3000/api/extract";

  let state = window.emptyParse();
  let rawSlip = "";
  let extracting = false;
  let digested = false;
  let pendingFile = null;

  function field(obj, path) {
    return path.split(".").reduce(function (acc, k) {
      return acc == null ? null : acc[k];
    }, obj);
  }

  function setField(path, value, source) {
    const parts = path.split(".");
    let cur = state;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = cur[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (cur[last] && typeof cur[last] === "object" && "value" in cur[last]) {
      cur[last].value = value;
      if (source) cur[last].source = source;
    } else {
      cur[last] = { value: value, source: source || "human" };
    }
  }

  function badge(source) {
    if (!source) return "";
    return '<span class="badge badge-' + source + '">' + source + "</span>";
  }

  function fmtKes(n) {
    if (n == null || n === "" || Number.isNaN(Number(n))) return "";
    return Number(n).toLocaleString("en-KE");
  }

  function parseKes(str) {
    if (str == null || str === "") return null;
    const n = Number(String(str).replace(/[^\d.-]/g, ""));
    return Number.isNaN(n) ? null : n;
  }

  function num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }

  function getLat() {
    return num(field(state, "coordinates.lat.value"));
  }
  function getLon() {
    return num(field(state, "coordinates.lon.value"));
  }

  function impliedRate() {
    const tiv = num(field(state, "exposure.tiv_kes.value"));
    const gfa = num(field(state, "exposure.floor_area_m2.value"));
    if (!tiv || !gfa) return null;
    return tiv / gfa;
  }

  function renderBadges() {
    const map = {
      "badge-lat": field(state, "coordinates.lat.source"),
      "badge-lon": field(state, "coordinates.lon.source"),
      "badge-elev": field(state, "coordinates.elevation_m.source"),
      "badge-class": field(state, "exposure.housing_class.source"),
      "badge-floors": field(state, "exposure.floors_above_ground.source"),
      "badge-basements": field(state, "exposure.basement_floors.source"),
      "badge-height": field(state, "exposure.total_height_m.source"),
      "badge-plinth": field(state, "exposure.first_floor_height_m.source"),
      "badge-tiv": field(state, "exposure.tiv_kes.source"),
      "badge-gfa": field(state, "exposure.floor_area_m2.source"),
      "badge-rate": field(state, "exposure.cost_per_m2_kes.source"),
      "badge-cover": field(state, "coverage.cover_subject.source"),
      "badge-dedpct": field(state, "financial_terms.deductible_pct.source"),
      "badge-dedmin": field(state, "financial_terms.deductible_min_kes.source"),
      "badge-limit": field(state, "financial_terms.policy_limit_kes.source"),
    };
    Object.keys(map).forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = badge(map[id]);
    });
  }

  function fillForm() {
    document.getElementById("lat").value = getLat() ?? "";
    document.getElementById("lon").value = getLon() ?? "";
    document.getElementById("elev").value =
      num(field(state, "coordinates.elevation_m.value")) ?? "";
    document.getElementById("housing_class").value =
      field(state, "exposure.housing_class.value") || "";
    document.getElementById("floors").value =
      num(field(state, "exposure.floors_above_ground.value")) ?? "";
    document.getElementById("basements").value =
      num(field(state, "exposure.basement_floors.value")) ?? "";
    document.getElementById("height").value =
      num(field(state, "exposure.total_height_m.value")) ?? "";
    document.getElementById("plinth").value =
      num(field(state, "exposure.first_floor_height_m.value")) ?? "";
    document.getElementById("plant").checked = Boolean(
      field(state, "exposure.critical_plant_in_basement.value")
    );
    const tiv = num(field(state, "exposure.tiv_kes.value"));
    document.getElementById("tiv").value = tiv == null ? "" : fmtKes(tiv);
    document.getElementById("gfa").value =
      num(field(state, "exposure.floor_area_m2.value")) ?? "";
    const subject = field(state, "coverage.cover_subject.value") || "building";
    const radio = document.querySelector(
      'input[name="cover_subject"][value="' + subject + '"]'
    );
    if (radio) radio.checked = true;
    const pct = num(field(state, "financial_terms.deductible_pct.value"));
    document.getElementById("ded_pct").value =
      pct == null ? "" : (pct * 100).toFixed(1);
    const dmin = num(field(state, "financial_terms.deductible_min_kes.value"));
    document.getElementById("ded_min").value = dmin == null ? "" : fmtKes(dmin);
    const lim = num(field(state, "financial_terms.policy_limit_kes.value"));
    document.getElementById("limit").value = lim == null ? "" : fmtKes(lim);
    document.getElementById("coverage_type").textContent =
      field(state, "coverage.coverage_type.value") || "—";
    document.getElementById("class_of_business").textContent =
      field(state, "coverage.class_of_business.value") || "—";
    document.getElementById("idle-panel").classList.toggle("hidden", digested);
    document.getElementById("digest-panel").classList.toggle("hidden", !digested);
    document.getElementById("shell").classList.toggle("digested-on", digested);
    document.getElementById("new-slip-btn").classList.toggle("hidden", !digested);

    const name =
      typeof state.property_name === "string"
        ? state.property_name
        : field(state, "property_name.value");
    const ref =
      typeof state.reference === "string"
        ? state.reference
        : field(state, "reference.value");
    document.getElementById("property_name").textContent =
      name || (digested ? "Untitled risk" : "No risk loaded");
    document.getElementById("reference").textContent = ref || "";
    updateDerived();
    renderProfile();
    renderBadges();
    renderStack();
    renderPlantWarning();
    validate();
  }

  function dash(v, suffix) {
    if (v == null || v === "") return "—";
    return suffix ? v + suffix : String(v);
  }

  function renderProfile() {
    if (!digested) return;
    const name =
      typeof state.property_name === "string"
        ? state.property_name
        : field(state, "property_name.value");
    const ref =
      typeof state.reference === "string"
        ? state.reference
        : field(state, "reference.value");
    const klass = field(state, "exposure.housing_class.value");
    const tiv = num(field(state, "exposure.tiv_kes.value"));
    const gfa = num(field(state, "exposure.floor_area_m2.value"));
    const lat = getLat();
    const lon = getLon();
    const elev = num(field(state, "coordinates.elevation_m.value"));
    const floors = num(field(state, "exposure.floors_above_ground.value"));
    const basements = num(field(state, "exposure.basement_floors.value"));
    const height = num(field(state, "exposure.total_height_m.value"));
    const plinth = num(field(state, "exposure.first_floor_height_m.value"));
    const subject = field(state, "coverage.cover_subject.value");
    const pct = num(field(state, "financial_terms.deductible_pct.value"));
    const dmin = num(field(state, "financial_terms.deductible_min_kes.value"));
    const lim = num(field(state, "financial_terms.policy_limit_kes.value"));
    const plant = Boolean(field(state, "exposure.critical_plant_in_basement.value"));
    const rate = impliedRate();

    document.getElementById("kpi-tiv").textContent =
      tiv == null ? "—" : "KES " + fmtKes(tiv);
    document.getElementById("kpi-tiv-note").textContent =
      field(state, "exposure.tiv_kes.source") || "";
    document.getElementById("kpi-class").textContent = CLASS_LABELS[klass] || "—";
    document.getElementById("kpi-class-note").textContent = klass || "Select a class";
    document.getElementById("kpi-gps").textContent =
      lat == null || lon == null ? "Not pinned" : lat.toFixed(4) + ", " + lon.toFixed(4);
    document.getElementById("kpi-gps-note").textContent =
      lat == null ? "Drop a pin on the Nairobi map" : "Inside raster check on run";
    document.getElementById("kpi-gfa").textContent =
      gfa == null ? "—" : Number(gfa).toLocaleString("en-KE") + " m²";
    document.getElementById("kpi-gfa-note").textContent =
      rate == null ? "" : "KES " + Math.round(rate).toLocaleString("en-KE") + " / m²";

    document.getElementById("fact-name").textContent = name || "—";
    document.getElementById("fact-ref").textContent = ref || "—";
    document.getElementById("fact-lat").textContent = lat == null ? "—" : lat.toFixed(4);
    document.getElementById("fact-lon").textContent = lon == null ? "—" : lon.toFixed(4);
    document.getElementById("fact-elev").textContent = elev == null ? "—" : elev + " m ASL";
    document.getElementById("fact-class").textContent = CLASS_LABELS[klass] || "—";
    document.getElementById("fact-storeys").textContent =
      floors == null && basements == null
        ? "—"
        : dash(floors) + " above / " + dash(basements ?? 0) + " below";
    document.getElementById("fact-height").textContent =
      height == null && plinth == null
        ? "—"
        : dash(height, " m") + " / plinth " + dash(plinth, " m");
    document.getElementById("fact-cover").textContent = COVER_LABELS[subject] || "—";
    document.getElementById("fact-coverage").textContent =
      field(state, "coverage.coverage_type.value") || "—";
    document.getElementById("fact-ded").textContent =
      pct == null && dmin == null
        ? "—"
        : (pct == null ? "—" : (pct * 100).toFixed(1) + "%") +
          (dmin == null ? "" : " / KES " + fmtKes(dmin) + " min");
    document.getElementById("fact-limit").textContent =
      lim == null ? "—" : "KES " + fmtKes(lim);
    document.getElementById("fact-cob").textContent =
      field(state, "coverage.class_of_business.value") || "—";
    document.getElementById("fact-plant").textContent = plant
      ? "Yes — generators / chillers in basement"
      : "No";
    const vitals = state.financial_terms && state.financial_terms.vital_considerations;
    document.getElementById("fact-vitals").textContent =
      Array.isArray(vitals) && vitals.length ? vitals.join(" · ") : "—";
  }

  function updateDerived() {
    const rate = impliedRate();
    const klass = field(state, "exposure.housing_class.value");
    const el = document.getElementById("implied_rate");
    const pill = document.getElementById("integrum_pill");
    if (rate == null) {
      el.textContent = "—";
      pill.textContent = "Need TIV and GFA";
      pill.className = "badge badge-empty";
      return;
    }
    el.textContent = "KES " + Math.round(rate).toLocaleString("en-KE") + " / m²";
    setField("exposure.cost_per_m2_kes", Math.round(rate * 10) / 10, "implied");
    const band = window.CLASS_COST_BANDS[klass];
    if (!band) {
      pill.textContent = "Select a construction class";
      pill.className = "badge badge-empty";
      return;
    }
    const ok = rate >= band.min && rate <= band.max;
    pill.textContent = ok
      ? "Within " + band.label + " range (KES " + band.min.toLocaleString() + "–" + band.max.toLocaleString() + "/m²)"
      : "Outside " + band.label + " range (KES " + band.min.toLocaleString() + "–" + band.max.toLocaleString() + "/m²)";
    pill.className = "badge " + (ok ? "badge-extracted" : "badge-human");
  }

  function renderPlantWarning() {
    const on = document.getElementById("plant").checked;
    document.getElementById("plant-warning").classList.toggle("hidden", !on);
  }

  function renderStack() {
    const floors = num(field(state, "exposure.floors_above_ground.value")) || 1;
    const basements = num(field(state, "exposure.basement_floors.value")) || 0;
    const plant = Boolean(field(state, "exposure.critical_plant_in_basement.value"));
    const plinth = num(field(state, "exposure.first_floor_height_m.value"));
    const host = document.getElementById("floor-stack");
    const parts = [];
    const upperTop = floors;
    const upperFrom = Math.min(2, floors);
    if (floors >= 2) {
      parts.push(
        '<div class="floor-band floor-upper"><div class="text-[10px] uppercase tracking-widest opacity-70">Upper floors</div><div>F' +
          upperFrom +
          "–F" +
          upperTop +
          " · dry office / residential</div></div>"
      );
    }
    parts.push(
      '<div class="floor-band floor-ground"><div class="text-[10px] uppercase tracking-widest opacity-60">Ground</div><div>Finished floor' +
        (plinth != null ? " · plinth " + plinth + " m" : "") +
        "</div></div>"
    );
    parts.push('<div class="floor-street" title="Street runoff"></div>');
    for (let b = 1; b <= basements; b++) {
      const plantNote =
        plant && b <= 2 ? " · generators / chillers" : "";
      parts.push(
        '<div class="floor-band floor-basement' +
          (plant ? " floor-plant" : "") +
          '"><div class="text-[10px] uppercase tracking-widest">Basement B' +
          b +
          "</div><div>Below grade" +
          plantNote +
          "</div></div>"
      );
    }
    if (!basements) {
      parts.push(
        '<div class="text-[10px] text-[var(--muted)] px-1">No basement (default 0 if unstated)</div>'
      );
    }
    host.innerHTML = parts.join("");
  }

  function validate() {
    const lat = getLat();
    const lon = getLon();
    const tiv = num(field(state, "exposure.tiv_kes.value"));
    const gfa = num(field(state, "exposure.floor_area_m2.value"));
    const klass = field(state, "exposure.housing_class.value");
    const status = document.getElementById("status-msg");
    const dot = document.getElementById("status-dot");
    const btn = document.getElementById("run-btn");
    const issues = [];

    if (!digested) {
      status.textContent = "Load or extract a slip to digest fields.";
      dot.className = "h-2.5 w-2.5 rounded-full bg-[#d9d3c9]";
      btn.disabled = true;
      btn.classList.add("opacity-40", "cursor-not-allowed");
      document.getElementById("status-wrap").dataset.blocked = "0";
      return false;
    }

    if (lat == null || lon == null) {
      issues.push("GPS missing — drop a pin on the Nairobi map.");
    } else if (!window.MapModal.insideRaster(lat, lon)) {
      issues.push(
        "GPS is outside the Nairobi raster (lon 36.60–37.00, lat −1.45 to −1.10)."
      );
    }
    if (!klass) issues.push("Construction class is required.");
    if (tiv == null && gfa == null) {
      issues.push("Need TIV or floor area to value the risk.");
    }

    const ready = issues.length === 0;
    status.textContent = ready
      ? "All fields verified. GPS inside Nairobi raster basin."
      : issues[0];
    dot.className =
      "h-2.5 w-2.5 rounded-full " + (ready ? "bg-[var(--green)]" : "bg-[var(--red)]");
    btn.disabled = !ready;
    btn.classList.toggle("opacity-40", !ready);
    btn.classList.toggle("cursor-not-allowed", !ready);
    document.getElementById("status-wrap").dataset.blocked = ready ? "0" : "1";
    return ready;
  }

  function applyParse(payload) {
    state = JSON.parse(JSON.stringify(payload));
    digested = true;
    fillForm();
    const panel = document.getElementById("digest-panel");
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function applyPin(lat, lon, source) {
    setField("coordinates.lat", roundCoord(lat), source || "human");
    setField("coordinates.lon", roundCoord(lon), source || "human");
    fillForm();
  }

  function roundCoord(n) {
    return Math.round(Number(n) * 10000) / 10000;
  }

  function onHuman(path, raw, extra) {
    let value = raw;
    if (extra === "kes") value = parseKes(raw);
    if (extra === "pct") value = num(raw) == null ? null : num(raw) / 100;
    if (extra === "num") value = num(raw);
    setField(path, value, "human");
    updateDerived();
    renderProfile();
    renderBadges();
    renderStack();
    validate();
  }

  function payload() {
    const rate = impliedRate();
    return {
      property_name:
        typeof state.property_name === "string"
          ? state.property_name
          : field(state, "property_name.value"),
      reference:
        typeof state.reference === "string"
          ? state.reference
          : field(state, "reference.value"),
      coordinates: {
        lat: getLat(),
        lon: getLon(),
        elevation_m: num(field(state, "coordinates.elevation_m.value")),
        source: {
          lat: field(state, "coordinates.lat.source"),
          lon: field(state, "coordinates.lon.source"),
          elevation_m: field(state, "coordinates.elevation_m.source"),
        },
      },
      exposure: {
        housing_class: field(state, "exposure.housing_class.value"),
        floor_area_m2: num(field(state, "exposure.floor_area_m2.value")),
        floors_above_ground: num(field(state, "exposure.floors_above_ground.value")),
        total_height_m: num(field(state, "exposure.total_height_m.value")),
        basement_floors: num(field(state, "exposure.basement_floors.value")),
        first_floor_height_m: num(field(state, "exposure.first_floor_height_m.value")),
        critical_plant_in_basement: Boolean(
          field(state, "exposure.critical_plant_in_basement.value")
        ),
        tiv_kes: num(field(state, "exposure.tiv_kes.value")),
        cost_per_m2_kes: rate,
      },
      coverage: {
        coverage_type: field(state, "coverage.coverage_type.value"),
        class_of_business: field(state, "coverage.class_of_business.value"),
        cover_subject: field(state, "coverage.cover_subject.value"),
      },
      financial_terms: {
        deductible_pct: num(field(state, "financial_terms.deductible_pct.value")),
        deductible_min_kes: num(
          field(state, "financial_terms.deductible_min_kes.value")
        ),
        policy_limit_kes: num(field(state, "financial_terms.policy_limit_kes.value")),
      },
      sources: collectSources(),
    };
  }

  function collectSources() {
    return {
      lat: field(state, "coordinates.lat.source"),
      lon: field(state, "coordinates.lon.source"),
      elevation_m: field(state, "coordinates.elevation_m.source"),
      housing_class: field(state, "exposure.housing_class.source"),
      cover_subject: field(state, "coverage.cover_subject.source"),
      tiv_kes: field(state, "exposure.tiv_kes.source"),
    };
  }

  function wrapField(value, source) {
    if (value == null || value === "") return { value: null, source: null };
    return { value: value, source: source || "extracted" };
  }

  function fromExtractApi(data) {
    const next = window.emptyParse();
    const src = "extracted";
    const coords = data.coordinates || {};
    const exp = data.exposure || {};
    const fin = data.financial_terms || {};
    const coordSrc =
      coords.source === "document_extracted" ||
      coords.lat != null ||
      coords.lon != null ||
      coords.elevation_m != null
        ? src
        : null;
    next.property_name = wrapField(data.property_name, src);
    next.reference = wrapField(data.reference, src);
    next.coordinates.lat = wrapField(coords.lat, coordSrc);
    next.coordinates.lon = wrapField(coords.lon, coordSrc);
    next.coordinates.elevation_m = wrapField(coords.elevation_m, coordSrc);
    next.exposure.housing_class = wrapField(exp.housing_class, src);
    next.exposure.floor_area_m2 = wrapField(exp.floor_area_m2, src);
    next.exposure.floors_above_ground = wrapField(exp.floors_above_ground, src);
    next.exposure.total_height_m = wrapField(exp.total_height_m, src);
    next.exposure.basement_floors = wrapField(exp.basement_floors, src);
    next.exposure.critical_plant_in_basement = wrapField(
      exp.critical_plant_in_basement,
      src
    );
    next.exposure.tiv_kes = wrapField(exp.tiv_kes, src);
    next.exposure.cost_per_m2_kes = wrapField(exp.cost_per_m2_kes, src);
    next.financial_terms.deductible_pct = wrapField(fin.deductible_pct, src);
    next.financial_terms.deductible_min_kes = wrapField(fin.deductible_min_kes, src);
    next.financial_terms.vital_considerations = Array.isArray(fin.vital_considerations)
      ? fin.vital_considerations
      : [];
    return next;
  }

  async function postExtract(file) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(EXTRACT_URL, { method: "POST", body: form });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      throw new Error(data.error || "Extract failed (" + res.status + ")");
    }
    return data;
  }

  async function loadDemoSlip() {
    pendingFile = null;
    try {
      const res = await fetch("data/sample_placement_slip.txt");
      rawSlip = await res.text();
    } catch (_) {
      rawSlip = document.getElementById("slip").placeholder;
    }
    document.getElementById("slip").value = rawSlip;
    toast("Slip loaded — sending to extraction service…");
    await extract();
  }

  async function extract() {
    rawSlip = document.getElementById("slip").value.trim();
    const btn = document.getElementById("extract-btn");
    if (!pendingFile && !rawSlip) {
      toast("Paste a slip, drop a file, or load the Landmark demo first.", true);
      return;
    }
    extracting = true;
    btn.disabled = true;
    document.getElementById("extract-spinner").classList.remove("hidden");
    try {
      const file =
        pendingFile ||
        new File([rawSlip], "placement-slip.txt", { type: "text/plain" });
      const data = await postExtract(file);
      pendingFile = null;
      applyParse(fromExtractApi(data));
      toast("Parsed by the extraction service.");
    } catch (err) {
      toast(err.message || "Extraction failed.", true);
    } finally {
      extracting = false;
      btn.disabled = false;
      document.getElementById("extract-spinner").classList.add("hidden");
    }
  }

  async function runModel() {
    if (!validate()) {
      if (getLat() == null || getLon() == null) {
        window.MapModal.open();
      }
      return;
    }
    const body = payload();
    try {
      const res = await fetch("/api/model/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("engine offline");
      toast("Handed off to catastrophe engine.");
    } catch (_) {
      showHandoff(body);
    }
  }

  function showHandoff(body) {
    try {
      sessionStorage.setItem("kenyaReHandoff", JSON.stringify(body));
    } catch (_) {}
    document.getElementById("handoff-json").textContent = JSON.stringify(
      body,
      null,
      2
    );
    document.getElementById("handoff-modal").classList.remove("hidden");
  }

  function toast(msg, danger) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    el.classList.toggle("text-[var(--red)]", !!danger);
    el.classList.toggle("text-[var(--green)]", !danger);
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.classList.add("hidden");
    }, 4200);
  }

  function bind() {
    ["lat", "lon", "elev"].forEach(function (id) {
      document.getElementById(id).addEventListener("change", function (e) {
        const path =
          id === "elev"
            ? "coordinates.elevation_m"
            : "coordinates." + (id === "lat" ? "lat" : "lon");
        onHuman(path, e.target.value, "num");
      });
    });
    document.getElementById("housing_class").addEventListener("change", function (e) {
      onHuman("exposure.housing_class", e.target.value);
    });
    document.getElementById("floors").addEventListener("change", function (e) {
      onHuman("exposure.floors_above_ground", e.target.value, "num");
      const h = num(field(state, "exposure.total_height_m.value"));
      const fl = num(e.target.value);
      if ((h == null || field(state, "exposure.total_height_m.source") !== "extracted") && fl) {
        setField("exposure.total_height_m", Math.round(fl * 3.5 * 10) / 10, "implied");
        document.getElementById("height").value = field(
          state,
          "exposure.total_height_m.value"
        );
      }
      fillForm();
    });
    document.getElementById("basements").addEventListener("change", function (e) {
      onHuman("exposure.basement_floors", e.target.value, "num");
      fillForm();
    });
    document.getElementById("height").addEventListener("change", function (e) {
      onHuman("exposure.total_height_m", e.target.value, "num");
    });
    document.getElementById("plinth").addEventListener("change", function (e) {
      onHuman("exposure.first_floor_height_m", e.target.value, "num");
      fillForm();
    });
    document.getElementById("plant").addEventListener("change", function (e) {
      setField("exposure.critical_plant_in_basement", e.target.checked, "human");
      renderPlantWarning();
      renderStack();
      renderProfile();
    });
    document.getElementById("tiv").addEventListener("change", function (e) {
      onHuman("exposure.tiv_kes", e.target.value, "kes");
      e.target.value = fmtKes(parseKes(e.target.value));
      fillForm();
    });
    document.getElementById("gfa").addEventListener("change", function (e) {
      onHuman("exposure.floor_area_m2", e.target.value, "num");
      fillForm();
    });
    document.querySelectorAll('input[name="cover_subject"]').forEach(function (r) {
      r.addEventListener("change", function (e) {
        onHuman("coverage.cover_subject", e.target.value);
      });
    });
    document.getElementById("ded_pct").addEventListener("change", function (e) {
      onHuman("financial_terms.deductible_pct", e.target.value, "pct");
    });
    document.getElementById("ded_min").addEventListener("change", function (e) {
      onHuman("financial_terms.deductible_min_kes", e.target.value, "kes");
      e.target.value = fmtKes(parseKes(e.target.value));
    });
    document.getElementById("limit").addEventListener("change", function (e) {
      onHuman("financial_terms.policy_limit_kes", e.target.value, "kes");
      e.target.value = fmtKes(parseKes(e.target.value));
    });

    document.getElementById("slip").addEventListener("input", function () {
      pendingFile = null;
    });
    document.getElementById("demo-btn").addEventListener("click", loadDemoSlip);
    document.getElementById("extract-btn").addEventListener("click", extract);
    document.getElementById("pin-btn").addEventListener("click", window.MapModal.open);
    document.getElementById("map-close").addEventListener("click", window.MapModal.close);
    document.getElementById("map-modal").addEventListener("click", function (e) {
      if (e.target.id === "map-modal") window.MapModal.close();
    });
    document.getElementById("geocode-go").addEventListener("click", window.MapModal.searchAddress);
    document.getElementById("geocode-q").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        window.MapModal.searchAddress();
      }
    });
    document.getElementById("new-slip-btn").addEventListener("click", function () {
      digested = false;
      state = window.emptyParse();
      rawSlip = "";
      pendingFile = null;
      document.getElementById("slip").value = "";
      document.getElementById("shell").classList.remove("digested-on");
      fillForm();
    });
    document.getElementById("run-btn").addEventListener("click", runModel);
    document.getElementById("handoff-close").addEventListener("click", function () {
      document.getElementById("handoff-modal").classList.add("hidden");
    });
    document.getElementById("status-wrap").addEventListener("click", function () {
      if (this.dataset.blocked === "1" && (getLat() == null || getLon() == null)) {
        window.MapModal.open();
      }
    });

    const drop = document.getElementById("dropzone");
    const file = document.getElementById("file");
    drop.addEventListener("click", function () {
      file.click();
    });
    drop.addEventListener("dragover", function (e) {
      e.preventDefault();
      drop.classList.add("border-[var(--accent)]");
    });
    drop.addEventListener("dragleave", function () {
      drop.classList.remove("border-[var(--accent)]");
    });
    drop.addEventListener("drop", function (e) {
      e.preventDefault();
      drop.classList.remove("border-[var(--accent)]");
      const f = e.dataTransfer.files[0];
      if (f) readFile(f);
    });
    file.addEventListener("change", function (e) {
      const f = e.target.files[0];
      if (f) readFile(f);
    });
  }

  function readFile(f) {
    pendingFile = f;
    const name = (f.name || "").toLowerCase();
    if (/\.(pdf|docx|xlsx|xls)$/.test(name)) {
      document.getElementById("slip").value =
        "(file) " + f.name + " — will upload to the extraction service";
      toast("Uploading " + f.name + "…");
      extract();
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      document.getElementById("slip").value = String(reader.result || "");
      toast("Slip loaded from " + f.name + " — extracting…");
      extract();
    };
    reader.readAsText(f);
  }

  window.IntakeApp = {
    applyPin: applyPin,
    getLat: getLat,
    getLon: getLon,
    payload: payload,
  };

  bind();
  fillForm();
})();
