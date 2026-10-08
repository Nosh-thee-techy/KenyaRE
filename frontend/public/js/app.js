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

  const API_BASE = (location.port && location.port !== "3000") ? (location.protocol + "//" + location.hostname + ":3000") : "";
  const INTAKE_LOCK_KEY = "kenyaReIntakeLock";
  const INTAKE_LOCK_VERSION = 1;
  const SLIP_MAX_CHARS = 1500000;
  const PAGE = document.body.getAttribute("data-page") || "intake";
  const IS_REVIEW = PAGE === "review";

  function byId(id) {
    return document.getElementById(id);
  }
  function setText(id, text) {
    const node = byId(id);
    if (node) node.textContent = text;
  }
  function setVal(id, value) {
    const node = byId(id);
    if (node) node.value = value;
  }
  const ADJUST_CONTROL_IDS = [
    "lat",
    "lon",
    "elev",
    "housing_class",
    "floors",
    "basements",
    "height",
    "plinth",
    "plant",
    "tiv",
    "gfa",
    "ded_pct",
    "ded_min",
    "limit",
  ];

  let state = window.emptyParse();
  let rawSlip = "";
  let extracting = false;
  let digested = false;
  let intakeLocked = false;
  let adjusting = false;
  let pendingFile = null;
  let pendingOverrides = null;
  let reviewAwaitingPin = false;
  let wizardSkipped = {};
  let reviewPrevFocus = null;

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

  function isIntakeUiLocked() {
    return Boolean(intakeLocked && digested);
  }

  function syncLockUi() {
    const locked = isIntakeUiLocked() && !IS_REVIEW;
    const unlockBtn = byId("unlock-edit-btn");
    if (unlockBtn) unlockBtn.classList.toggle("hidden", !locked);
    const hint = byId("profile-lock-hint");
    if (hint) {
      hint.textContent = IS_REVIEW
        ? "Edit anything the slip left blank"
        : "From the slip — open Review to complete";
    }
    ADJUST_CONTROL_IDS.forEach(function (id) {
      const node = byId(id);
      if (node) node.disabled = locked;
    });
    document.querySelectorAll('input[name="cover_subject"]').forEach(function (el) {
      el.disabled = locked;
    });
  }

  function syncReviewCta() {
    const cta = byId("review-cta");
    if (cta) {
      const on = digested;
      cta.classList.toggle("opacity-40", !on);
      cta.classList.toggle("pointer-events-none", !on);
      cta.setAttribute("aria-disabled", on ? "false" : "true");
    }
    const hint = byId("intake-hint");
    if (hint) {
      hint.textContent = digested
        ? "Review the digested fields, then run the catastrophe model."
        : "Extract a slip to digest the risk, then review before you run.";
    }
  }

  function syncPanels() {
    const digest = byId("digest-panel");
    const empty = byId("empty-review");
    if (digest) digest.classList.toggle("hidden", !digested);
    if (empty) empty.classList.toggle("hidden", digested);
    const shell = byId("shell");
    if (shell) shell.classList.toggle("digested-on", digested && !IS_REVIEW);
    const newSlip = byId("new-slip-btn");
    if (newSlip) newSlip.classList.toggle("hidden", !digested);
    syncReviewCta();
  }

  function openAdjustView(formId) {
    persistIntakeLock();
    if (IS_REVIEW) {
      intakeLocked = false;
      syncLockUi();
      const node = formId ? byId(formId) : byId("adjust-fields");
      if (node) {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
        if (typeof node.focus === "function") node.focus();
      }
      return;
    }
    const hash = formId ? "#" + encodeURIComponent(formId) : "";
    location.href = "review.html" + hash;
  }

  function unlockIntake() {
    if (!digested) return;
    intakeLocked = false;
    syncLockUi();
  }

  function clearIntakeLock() {
    try {
      localStorage.removeItem(INTAKE_LOCK_KEY);
    } catch (_) {}
  }

  function persistIntakeLock() {
    if (!digested) return;
    let slip = typeof rawSlip === "string" ? rawSlip : "";
    if (slip.length > SLIP_MAX_CHARS) slip = slip.slice(0, SLIP_MAX_CHARS);
    const blob = {
      v: INTAKE_LOCK_VERSION,
      digested: true,
      locked: true,
      state: state,
      rawSlip: slip,
      pendingOverrides: pendingOverrides || null,
    };
    try {
      localStorage.setItem(INTAKE_LOCK_KEY, JSON.stringify(blob));
    } catch (_) {
      try {
        blob.rawSlip = "";
        localStorage.setItem(INTAKE_LOCK_KEY, JSON.stringify(blob));
      } catch (__) {}
    }
  }

  function restoreIntakeLock() {
    let raw;
    try {
      raw = localStorage.getItem(INTAKE_LOCK_KEY);
    } catch (_) {
      return false;
    }
    if (!raw) return false;
    let saved;
    try {
      saved = JSON.parse(raw);
    } catch (_) {
      return false;
    }
    if (!saved || saved.digested !== true || !saved.state || typeof saved.state !== "object") {
      return false;
    }
    try {
      state = JSON.parse(JSON.stringify(saved.state));
    } catch (_) {
      return false;
    }
    rawSlip = typeof saved.rawSlip === "string" ? saved.rawSlip : "";
    digested = true;
    intakeLocked = !IS_REVIEW;
    adjusting = false;
    pendingFile = null;
    pendingOverrides =
      saved.pendingOverrides && typeof saved.pendingOverrides === "object"
        ? JSON.parse(JSON.stringify(saved.pendingOverrides))
        : null;
    const slipEl = document.getElementById("slip");
    if (slipEl) slipEl.value = rawSlip;
    try {
      fillForm();
    } catch (_) {
      digested = false;
      intakeLocked = false;
      adjusting = false;
      pendingOverrides = null;
      state = window.emptyParse();
      if (slipEl) slipEl.value = "";
      clearIntakeLock();
      return false;
    }
    return true;
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

  function isSlipStated(source) {
    return source === "extracted" || source === "human";
  }

  function statedRebuildRate() {
    const tiv = num(field(state, "exposure.tiv_kes.value"));
    const gfa = num(field(state, "exposure.floor_area_m2.value"));
    const tivSrc = field(state, "exposure.tiv_kes.source");
    const gfaSrc = field(state, "exposure.floor_area_m2.source");
    if (!tiv || !gfa) return null;
    if (!isSlipStated(tivSrc) || !isSlipStated(gfaSrc)) return null;
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
    if (byId("lat")) {
      setVal("lat", getLat() ?? "");
      setVal("lon", getLon() ?? "");
      setVal("elev", num(field(state, "coordinates.elevation_m.value")) ?? "");
      setVal("housing_class", field(state, "exposure.housing_class.value") || "");
      setVal("floors", num(field(state, "exposure.floors_above_ground.value")) ?? "");
      setVal("basements", num(field(state, "exposure.basement_floors.value")) ?? "");
      setVal("height", num(field(state, "exposure.total_height_m.value")) ?? "");
      setVal("plinth", num(field(state, "exposure.first_floor_height_m.value")) ?? "");
      const plant = byId("plant");
      if (plant) {
        plant.checked = Boolean(field(state, "exposure.critical_plant_in_basement.value"));
      }
      const tiv = num(field(state, "exposure.tiv_kes.value"));
      setVal("tiv", tiv == null ? "" : fmtKes(tiv));
      setVal("gfa", num(field(state, "exposure.floor_area_m2.value")) ?? "");
      const subject = field(state, "coverage.cover_subject.value") || "building";
      const radio = document.querySelector(
        'input[name="cover_subject"][value="' + subject + '"]'
      );
      if (radio) radio.checked = true;
      const pct = num(field(state, "financial_terms.deductible_pct.value"));
      setVal("ded_pct", pct == null ? "" : (pct * 100).toFixed(1));
      const dmin = num(field(state, "financial_terms.deductible_min_kes.value"));
      setVal("ded_min", dmin == null ? "" : fmtKes(dmin));
      const lim = num(field(state, "financial_terms.policy_limit_kes.value"));
      setVal("limit", lim == null ? "" : fmtKes(lim));
      setText("coverage_type", field(state, "coverage.coverage_type.value") || "—");
      setText("class_of_business", field(state, "coverage.class_of_business.value") || "—");
    }
    syncPanels();
    syncLockUi();

    const name =
      typeof state.property_name === "string"
        ? state.property_name
        : field(state, "property_name.value");
    const ref =
      typeof state.reference === "string"
        ? state.reference
        : field(state, "reference.value");
    setText("property_name", name || (digested ? "Untitled risk" : "No risk loaded"));
    setText("reference", ref || "");
    updateDerived();
    renderProfile();
    renderBadges();
    renderStack();
    renderPlantWarning();
    validate();
    renderBlocker();
    renderPageMissing();
  }

  function renderBlocker() {
    const el = document.getElementById("blocker-alert");
    const msg = document.getElementById("blocker-msg");
    if (!el) return;
    const blocked = Boolean(
      state.audit && (state.audit.is_blocked === true || state.audit.is_blocked === "true")
    );
    const reasons = (state.audit && state.audit.block_reasons) || [];
    const gpsMissing = getLat() == null || getLon() == null;
    const show = digested && (blocked || gpsMissing);
    el.classList.toggle("hidden", !show);
    if (msg) {
      msg.textContent = reasons.length
        ? reasons.join(" ")
        : "GPS is missing. Drop a pin on the Nairobi map.";
    }
  }

  function dash(v, suffix) {
    if (v == null || v === "") return "—";
    return suffix ? v + suffix : String(v);
  }

  function sourceExplain(source, opts) {
    opts = opts || {};
    const missing = opts.missing || "Not found on the slip.";
    if (!source) return missing;
    if (source === "extracted" || source === "document_extracted") {
      return "Read from the broker slip.";
    }
    if (source === "implied" || source === "derived") {
      return opts.implied || "Estimated from other slip values (not stated on the slip).";
    }
    if (source === "class_default") {
      return "Filled from the construction-class table, not the slip.";
    }
    if (source === "geocoded") {
      return "Resolved from the street address (OpenStreetMap), not printed GPS.";
    }
    if (source === "human") {
      return "Entered or pinned by the underwriter.";
    }
    if (source === "dem") {
      return "Sampled from Copernicus DEM, not the slip.";
    }
    return missing;
  }

  function setKpiWhy(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
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

    document.getElementById("kpi-tiv").textContent =
      tiv == null ? "—" : "KES " + fmtKes(tiv);
    document.getElementById("kpi-tiv-note").textContent =
      tiv == null ? "Not found" : field(state, "exposure.tiv_kes.source") || "";
    setKpiWhy(
      "kpi-tiv-why",
      tiv == null
        ? "Not found on the slip."
        : sourceExplain(field(state, "exposure.tiv_kes.source"), {
            missing: "Not found on the slip.",
            implied: "Estimated as floor area × rebuild rate (not stated on the slip).",
          })
    );
    document.getElementById("kpi-class").textContent = CLASS_LABELS[klass] || "—";
    document.getElementById("kpi-class-note").textContent = klass
      ? klass
      : "Not found";
    setKpiWhy(
      "kpi-class-why",
      !klass
        ? "Not found on the slip. Choose a class on Review."
        : sourceExplain(field(state, "exposure.housing_class.source"), {
            missing: "Not found on the slip. Choose a class on Review.",
          })
    );
    document.getElementById("kpi-gps").textContent =
      lat == null || lon == null ? "Not pinned" : lat.toFixed(4) + ", " + lon.toFixed(4);
    document.getElementById("kpi-gps-note").textContent =
      lat == null ? "Drop a pin on the Nairobi map" : "Inside raster check on run";
    const gpsSrc =
      field(state, "coordinates.lat.source") ||
      field(state, "coordinates.lon.source");
    setKpiWhy(
      "kpi-gps-why",
      lat == null || lon == null
        ? "No coordinates on the slip. Pin the building on the Nairobi map."
        : sourceExplain(gpsSrc, {
            missing: "No coordinates on the slip. Pin the building on the Nairobi map.",
          })
    );
    document.getElementById("kpi-gfa").textContent =
      gfa == null ? "—" : Number(gfa).toLocaleString("en-KE") + " m²";
    const gfaRate = statedRebuildRate();
    document.getElementById("kpi-gfa-note").textContent =
      gfaRate == null
        ? ""
        : "KES " + Math.round(gfaRate).toLocaleString("en-KE") + " / m²";
    let gfaWhy =
      gfa == null
        ? "Not found on the slip."
        : sourceExplain(field(state, "exposure.floor_area_m2.source"), {
            missing: "Not found on the slip.",
          });
    if (gfa != null && gfaRate != null) {
      gfaWhy += " TIV ÷ floor area.";
    }
    setKpiWhy("kpi-gfa-why", gfaWhy);

    const factName = document.getElementById("fact-name");
    if (!factName) return;
    factName.textContent = name || "—";
    document.getElementById("fact-ref").textContent = ref || "—";
    document.getElementById("fact-lat").textContent = lat == null ? "—" : lat.toFixed(4);
    document.getElementById("fact-lon").textContent = lon == null ? "—" : lon.toFixed(4);
    document.getElementById("fact-elev").textContent = elev == null ? "—" : elev + " m ASL";
    document.getElementById("fact-class").textContent = CLASS_LABELS[klass] || "—";
    const srcLat = document.getElementById("src-lat");
    const srcLon = document.getElementById("src-lon");
    const srcElev = document.getElementById("src-elev");
    const srcClass = document.getElementById("src-class");
    if (srcLat) srcLat.innerHTML = badge(field(state, "coordinates.lat.source"));
    if (srcLon) srcLon.innerHTML = badge(field(state, "coordinates.lon.source"));
    if (srcElev) srcElev.innerHTML = badge(field(state, "coordinates.elevation_m.source"));
    if (srcClass) srcClass.innerHTML = badge(field(state, "exposure.housing_class.source"));
    document.getElementById("fact-storeys").textContent =
      floors == null && basements == null
        ? "—"
        : dash(floors) + " above / " + dash(basements ?? 0) + " below";
    document.getElementById("fact-height").textContent =
      height == null && plinth == null
        ? "—"
        : dash(height, " m") +
          (plinth == null ? "" : " / plinth " + dash(plinth, " m"));
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
    const el = byId("implied_rate");
    const pill = byId("integrum_pill");
    if (!el || !pill) return;
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
    const plant = byId("plant");
    const warn = byId("plant-warning");
    if (!plant || !warn) return;
    warn.classList.toggle("hidden", !plant.checked);
  }

  function renderStack() {
    const statedFloors = num(field(state, "exposure.floors_above_ground.value"));
    const floors = statedFloors == null ? 1 : Math.max(1, statedFloors);
    const basements = num(field(state, "exposure.basement_floors.value")) || 0;
    const plant = Boolean(field(state, "exposure.critical_plant_in_basement.value"));
    const plinth = num(field(state, "exposure.first_floor_height_m.value"));
    const host = byId("floor-stack");
    if (!host) return;

    function windows(n) {
      let html = '<span class="building-windows" aria-hidden="true">';
      for (let i = 0; i < n; i++) html += '<i class="building-win"></i>';
      return html + "</span>";
    }

    function plate(label, note, kind) {
      return (
        '<div class="building-floor building-' +
        kind +
        '"><span class="building-wall"></span><div class="building-plate"><span class="building-flabel">' +
        label +
        "</span>" +
        (note ? '<span class="building-note">' + note + "</span>" : "") +
        windows(5) +
        '</div><span class="building-wall"></span></div>'
      );
    }

    const height = num(field(state, "exposure.total_height_m.value"));
    const heightLabel =
      height != null ? height + " m" : "Height not found";

    const parts = [
      '<div class="building-wrap">',
      '<div class="building-elev">',
      '<div class="building-roof" title="Roof"></div>'
    ];
    for (let f = floors; f >= 2; f--) {
      parts.push(plate("F" + f, "", "upper"));
    }
    parts.push(
      plate(
        "G",
        "Ground" + (plinth != null ? " · plinth " + plinth + " m" : ""),
        "ground"
      )
    );
    parts.push('<div class="building-grade" title="Street / grade"></div>');
    if (basements) {
      parts.push('<div class="building-subgrade">');
      for (let b = 1; b <= basements; b++) {
        const note =
          plant && b <= 2
            ? '<span class="badge" style="background:var(--brand-soft);color:var(--brand)">Critical plant</span>'
            : "Below grade";
        parts.push(plate("B" + b, note, plant && b <= 2 ? "plant" : "basement"));
      }
      parts.push("</div>");
    }
    parts.push("</div>");
    parts.push(
      '<div class="building-ruler" aria-label="Building height">' +
        '<span class="building-ruler-top">' +
        heightLabel +
        "</span>" +
        '<span class="building-ruler-line"></span>' +
        '<span class="building-ruler-bot">0 m · grade</span>' +
        (basements
          ? '<span class="building-ruler-sub">B' + basements + "</span>"
          : "") +
        "</div>"
    );
    parts.push("</div>");
    host.innerHTML = parts.join("");
  }

  function setRunReady(ready) {
    const btn = document.getElementById("run-btn");
    if (!btn) return;
    btn.setAttribute("aria-disabled", ready ? "false" : "true");
    btn.classList.toggle("opacity-40", !ready);
    btn.classList.toggle("cursor-not-allowed", !ready);
  }

  function validate() {
    const lat = getLat();
    const lon = getLon();
    const tiv = num(field(state, "exposure.tiv_kes.value"));
    const gfa = num(field(state, "exposure.floor_area_m2.value"));
    const klass = field(state, "exposure.housing_class.value");
    const issues = [];
    const status = byId("status-msg");
    const dot = byId("status-dot");
    const wrap = byId("status-wrap");

    if (!digested) {
      if (status) status.textContent = "Extract a slip on Intake, then complete missing fields here.";
      if (dot) dot.className = "h-2.5 w-2.5 rounded-full bg-[#d9d3c9]";
      if (wrap) wrap.dataset.blocked = "0";
      setRunReady(false);
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
    if (status) {
      status.textContent = ready
        ? "All fields verified. GPS inside Nairobi raster basin."
        : issues[0];
    }
    if (dot) {
      dot.className =
        "h-2.5 w-2.5 rounded-full " + (ready ? "bg-[var(--green)]" : "bg-[var(--red)]");
    }
    if (wrap) wrap.dataset.blocked = ready ? "0" : "1";
    setRunReady(ready);
    return ready;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function taggedAt(path) {
    const node = field(state, path);
    if (node == null) return { value: null, source: null };
    if (typeof node === "object" && "value" in node) {
      return { value: node.value, source: node.source || null };
    }
    return { value: node, source: null };
  }

  function isEmptyVal(v) {
    return v == null || v === "";
  }

  function isReviewOpen() {
    const el = document.getElementById("review-modal");
    return Boolean(el && !el.classList.contains("hidden"));
  }

  function propertyName() {
    return typeof state.property_name === "string"
      ? state.property_name
      : field(state, "property_name.value");
  }

  function getGeocodeSuggestion() {
    const s = state.audit && state.audit.geocode_suggestion;
    if (s && s.lat != null && s.lon != null) return s;
    const src = field(state, "coordinates.lat.source");
    if (src === "geocoded" && getLat() != null && getLon() != null) {
      return {
        query: "",
        label: "Looked up from the slip address",
        lat: getLat(),
        lon: getLon(),
      };
    }
    return null;
  }

  function locationCopy() {
    const sug = getGeocodeSuggestion();
    if (sug && sug.lat != null && sug.lon != null) {
      const q = sug.query
        ? "“" + sug.query + "”"
        : "the address on the slip";
      return {
        title: "Is this the location?",
        lead:
          "I didn’t find GPS on the slip. I searched " +
          q +
          " and found this. Is this the one, or would you like to pin?",
      };
    }
    return {
      title: "Where is the building?",
      lead: "I didn’t find GPS on the slip. Pin it on the Nairobi map, then press Okay.",
    };
  }

  async function enrichGeocodeSuggestion() {
    const latSrc = field(state, "coordinates.lat.source");
    if (latSrc === "extracted" && getLat() != null) return;
    if (state.audit && state.audit.geocode_confirmed) return;
    if (state.audit && state.audit.geocode_suggestion) return;
    const q = (
      (state.audit && state.audit.extracted_address) ||
      (state.audit && state.audit.geocode_suggestion && state.audit.geocode_suggestion.query) ||
      propertyName() ||
      ""
    ).trim();
    if (!q || q === "Unnamed Property") return;
    try {
      const res = await fetch(
        API_BASE + "/api/intake/geocode?q=" + encodeURIComponent(q)
      );
      if (!res.ok) return;
      const hits = await res.json();
      const hit = Array.isArray(hits) ? hits[0] : null;
      if (!hit || hit.lat == null || hit.lon == null) return;
      if (!state.audit) state.audit = {};
      state.audit.geocode_suggestion = {
        query: q,
        label: hit.label,
        lat: hit.lat,
        lon: hit.lon,
      };
    } catch (_) {}
  }

  function computeReviewDigest() {
    const lat = getLat();
    const lon = getLon();
    const locPresent = lat != null && lon != null;
    const latSrc = field(state, "coordinates.lat.source");
    const locConfirmed =
      locPresent &&
      (latSrc === "extracted" ||
        latSrc === "human" ||
        Boolean(state.audit && state.audit.geocode_confirmed));
    const outsideRaster =
      locConfirmed && !window.MapModal.insideRaster(lat, lon);
    const gpsMissing = !locConfirmed || outsideRaster;

    const klass = taggedAt("exposure.housing_class");
    const classFromSlip =
      !isEmptyVal(klass.value) &&
      klass.source &&
      klass.source !== "class_default";
    const floors = taggedAt("exposure.floors_above_ground");
    const floorsFromSlip =
      !isEmptyVal(floors.value) &&
      floors.source &&
      floors.source !== "class_default";
    const height = taggedAt("exposure.total_height_m");
    const heightFromSlip =
      !isEmptyVal(height.value) &&
      height.source &&
      height.source !== "class_default" &&
      height.source !== "implied";
    const gfa = taggedAt("exposure.floor_area_m2");
    const tiv = taggedAt("exposure.tiv_kes");
    const tivPresent =
      !isEmptyVal(tiv.value) && tiv.source && tiv.source !== "class_default";
    const gfaPresent = !isEmptyVal(gfa.value);
    const valueRequired = !tivPresent && !gfaPresent;

    const items = [
      {
        id: "location",
        label: "Location (GPS)",
        present: !gpsMissing,
        hint: outsideRaster
          ? "Pin is outside the Nairobi raster."
          : "No coordinates on the slip.",
        required: true,
        input: "pin",
        formId: "pin-btn",
        prompt: true,
      },
      {
        id: "class",
        label: "Construction class",
        present: classFromSlip,
        hint: "Not found on the slip.",
        required: true,
        input: "class",
        formId: "housing_class",
        prompt: true,
      },
      {
        id: "tiv",
        label: "Sum insured (TIV)",
        present: tivPresent,
        hint: "Not found on the slip.",
        required: valueRequired,
        input: "tiv",
        formId: "tiv",
        prompt: true,
      },
      {
        id: "gfa",
        label: "Gross floor area",
        present: gfaPresent,
        hint: "Not found on the slip.",
        required: valueRequired,
        input: "gfa",
        formId: "gfa",
        prompt: true,
      },
      {
        id: "floors",
        label: "Floors above ground",
        present: floorsFromSlip,
        hint: "Not found on the slip.",
        required: false,
        input: "floors",
        formId: "floors",
        prompt: true,
      },
      {
        id: "height",
        label: "Building height",
        present: heightFromSlip,
        hint: "Not found on the slip.",
        required: false,
        input: "height",
        formId: "height",
        prompt: true,
      },
    ];

    const missing = items.filter(function (it) {
      return !it.present;
    });
    const promptMissing = missing.filter(function (it) {
      return it.prompt;
    });
    const optionalMissing = missing.filter(function (it) {
      return !it.prompt;
    });

    return {
      items: items,
      missing: missing,
      promptMissing: promptMissing,
      optionalMissing: optionalMissing,
      gapItems: promptMissing.concat(optionalMissing),
      gpsMissing: gpsMissing,
      outsideRaster: outsideRaster,
      shouldPrompt: promptMissing.length > 0,
      requiredReady: !gpsMissing && classFromSlip && !valueRequired,
    };
  }

  function classSelectHtml() {
    return (
      '<select id="review-in-class" class="w-full px-3 py-2 text-sm">' +
      '<option value="">Choose class…</option>' +
      '<option value="concrete_rcc">concrete_rcc — RCC frame</option>' +
      '<option value="permanent_masonry">permanent_masonry — stone / brick</option>' +
      '<option value="semi_permanent">semi_permanent — timber / mud plaster</option>' +
      '<option value="informal_iron_sheet">informal_iron_sheet — mabati</option>' +
      "</select>"
    );
  }

  function reviewGapHtml(item) {
    const req = item.required ? " review-item-required" : "";
    const labelExtra = item.required ? " · required" : "";
    let cta = "";
    if (item.input === "pin") {
      const sug = getGeocodeSuggestion();
      if (sug && sug.lat != null && sug.lon != null) {
        cta =
          '<div class="geo-suggest">' +
          '<p class="review-item-value">' +
          escapeHtml(sug.label || "A Nairobi match") +
          "</p>" +
          '<p class="mono text-sm">' +
          Number(sug.lat).toFixed(4) +
          ", " +
          Number(sug.lon).toFixed(4) +
          "</p>" +
          '<div class="review-gap-row">' +
          '<button type="button" class="btn-primary px-3 py-2 text-sm" data-review-cta="accept-geo">Yes, that is the one</button>' +
          '<button type="button" class="btn-ghost px-3 py-2 text-sm" data-review-cta="pin">No, I will pin</button>' +
          "</div></div>";
      } else {
        cta =
          '<button type="button" class="btn-primary px-3 py-2 text-sm" data-review-cta="pin">Pin on Nairobi map</button>';
      }
    } else if (item.input === "class") {
      cta = classSelectHtml();
    } else if (item.input === "tiv") {
      cta =
        '<div class="review-gap-row">' +
        '<input id="review-in-tiv" type="text" inputmode="numeric" class="px-3 py-2 mono text-sm" placeholder="TIV (KES)" />' +
        '<button type="button" class="btn-primary px-3 py-2 text-sm" data-review-cta="apply-tiv">Okay</button>' +
        "</div>";
    } else if (item.input === "gfa") {
      cta =
        '<div class="review-gap-row">' +
        '<input id="review-in-gfa" type="number" class="px-3 py-2 mono text-sm" placeholder="GFA m²" />' +
        '<button type="button" class="btn-primary px-3 py-2 text-sm" data-review-cta="apply-gfa">Okay</button>' +
        "</div>";
    } else if (item.input === "floors") {
      cta =
        '<div class="review-gap-row">' +
        '<input id="review-in-floors" type="number" min="1" class="px-3 py-2 mono text-sm" placeholder="Floors" />' +
        '<button type="button" class="btn-primary px-3 py-2 text-sm" data-review-cta="apply-floors">Okay</button>' +
        "</div>";
    } else if (item.input === "height") {
      cta =
        '<div class="review-gap-row">' +
        '<input id="review-in-height" type="number" step="0.1" class="px-3 py-2 mono text-sm" placeholder="Height m" />' +
        '<button type="button" class="btn-primary px-3 py-2 text-sm" data-review-cta="apply-height">Okay</button>' +
        "</div>";
    } else {
      cta =
        '<button type="button" class="btn-ghost px-3 py-2 text-sm" data-review-cta="adjust" data-form-id="' +
        escapeHtml(item.formId || "") +
        '">Enter on Review</button>';
    }
    const hideHint = item.input === "pin" && getGeocodeSuggestion();
    return (
      '<li class="review-gap' +
      req +
      '" data-id="' +
      escapeHtml(item.id) +
      '"><span class="review-item-label">' +
      escapeHtml(item.label) +
      labelExtra +
      "</span>" +
      (hideHint
        ? ""
        : '<span class="review-item-value">' +
          escapeHtml(item.hint || "Not found on the slip.") +
          "</span>") +
      cta +
      "</li>"
    );
  }

  const GAP_COPY = {
    location: {
      title: "Where is the building?",
      lead: "I didn’t find GPS on the slip. Pin it on the Nairobi map, then press Okay.",
    },
    class: {
      title: "What is the construction?",
      lead: "Class was not found. Choose one so we do not guess masonry.",
    },
    tiv: {
      title: "What is the sum insured?",
      lead: "TIV was not found. Enter the declared amount in KES.",
    },
    gfa: {
      title: "What is the floor area?",
      lead: "Gross floor area was not found. Enter square metres.",
    },
    floors: {
      title: "How many floors above ground?",
      lead: "Storeys were not stated. Enter a number, or skip.",
    },
    height: {
      title: "What is the building height?",
      lead: "Height was not stated. Enter metres to the roof, or skip.",
    },
  };

  function wizardGaps() {
    return computeReviewDigest().gapItems.filter(function (it) {
      return !wizardSkipped[it.id];
    });
  }

  function renderReviewModal() {
    const digest = computeReviewDigest();
    const missingEl = document.getElementById("review-missing");
    const lead = document.getElementById("review-lead");
    const title = document.getElementById("review-title");
    const progress = document.getElementById("review-progress");
    if (!missingEl) return digest;

    const remaining = wizardGaps();
    const total = digest.gapItems.length;
    const done = total - remaining.length;
    const item = remaining[0];

    if (!item) {
      missingEl.innerHTML = "";
      if (title) title.textContent = "That’s everything we needed to ask";
      if (lead) lead.textContent = "You can go to Review when you are ready.";
      if (progress) progress.textContent = "";
      return digest;
    }

    const copy =
      item.id === "location"
        ? locationCopy()
        : GAP_COPY[item.id] || {
            title: item.label + " was not found",
            lead: item.hint || "Not found on the slip.",
          };
    if (title) title.textContent = copy.title;
    if (lead) lead.textContent = copy.lead;
    if (progress) {
      progress.textContent =
        "Question " + (done + 1) + " of " + total;
    }
    missingEl.innerHTML = reviewGapHtml(item);
    return digest;
  }

  function renderPageMissing() {
    const host = byId("page-missing");
    const card = byId("page-missing-card");
    const lead = byId("page-missing-lead");
    if (!host) return;
    if (!digested) {
      if (card) card.classList.add("hidden");
      return;
    }
    const digest = computeReviewDigest();
    host.innerHTML = digest.gapItems.length
      ? digest.gapItems
          .map(function (it) {
            return reviewGapHtml(it);
          })
          .join("")
      : "";
    if (card) card.classList.toggle("hidden", digest.gapItems.length === 0);
    if (lead) {
      lead.textContent = digest.gpsMissing
        ? locationCopy().lead
        : "These fields were not found on the slip.";
    }
  }

  function focusReview() {
    const accept = document.querySelector(
      '#review-missing [data-review-cta="accept-geo"]'
    );
    const pin = document.querySelector('#review-missing [data-review-cta="pin"]');
    const firstInput = document.querySelector(
      "#review-missing select, #review-missing input"
    );
    const firstCta = document.querySelector("#review-missing [data-review-cta]");
    const skip = document.getElementById("review-skip-btn");
    const target = accept || pin || firstInput || firstCta || skip;
    if (target) target.focus();
  }

  function openReviewModal() {
    const el = document.getElementById("review-modal");
    if (!el) return;
    reviewPrevFocus = document.activeElement;
    renderReviewModal();
    el.classList.remove("hidden");
    el.setAttribute("aria-hidden", "false");
    requestAnimationFrame(focusReview);
  }

  function openReviewIfNeeded() {
    wizardSkipped = {};
    const remaining = wizardGaps();
    if (!remaining.length) return false;
    openReviewModal();
    return true;
  }

  function skipWizardQuestion() {
    const remaining = wizardGaps();
    if (remaining[0]) wizardSkipped[remaining[0].id] = true;
    if (!wizardGaps().length) {
      closeReviewModal("skip");
      return;
    }
    renderReviewModal();
    requestAnimationFrame(focusReview);
  }

  function closeReviewModal(reason) {
    const el = document.getElementById("review-modal");
    if (!el) return;
    el.classList.add("hidden");
    el.setAttribute("aria-hidden", "true");
    if (reason !== "pin") reviewAwaitingPin = false;
    if (reviewPrevFocus && typeof reviewPrevFocus.focus === "function") {
      try {
        reviewPrevFocus.focus();
      } catch (_) {}
    }
  }

  function finishReviewAction() {
    const digest = computeReviewDigest();
    if (!digest.shouldPrompt) {
      closeReviewModal("filled");
      return;
    }
    renderReviewModal();
    renderPageMissing();
  }

  function applyReviewClass() {
    const klass = document.getElementById("review-in-class");
    if (!klass || !klass.value) return false;
    setField("exposure.housing_class", klass.value, "human");
    fillForm();
    persistIntakeLock();
    finishReviewAction();
    return true;
  }

  function applyReviewTiv() {
    const tiv = document.getElementById("review-in-tiv");
    if (!tiv || !tiv.value.trim()) return false;
    const n = parseKes(tiv.value);
    if (n == null) return false;
    setField("exposure.tiv_kes", n, "human");
    fillForm();
    persistIntakeLock();
    finishReviewAction();
    return true;
  }

  function applyReviewGfa() {
    const gfa = document.getElementById("review-in-gfa");
    if (!gfa || gfa.value === "") return false;
    const n = num(gfa.value);
    if (n == null) return false;
    setField("exposure.floor_area_m2", n, "human");
    fillForm();
    persistIntakeLock();
    finishReviewAction();
    return true;
  }

  function applyReviewFloors() {
    const el = document.getElementById("review-in-floors");
    if (!el || el.value === "") return false;
    const n = num(el.value);
    if (n == null) return false;
    setField("exposure.floors_above_ground", n, "human");
    fillForm();
    persistIntakeLock();
    finishReviewAction();
    return true;
  }

  function applyReviewHeight() {
    const el = document.getElementById("review-in-height");
    if (!el || el.value === "") return false;
    const n = num(el.value);
    if (n == null) return false;
    setField("exposure.total_height_m", n, "human");
    fillForm();
    persistIntakeLock();
    finishReviewAction();
    return true;
  }

  function openPinFromReview() {
    reviewAwaitingPin = true;
    closeReviewModal("pin");
    window.MapModal.open();
  }

  function acceptGeocodeSuggestion() {
    const sug = getGeocodeSuggestion();
    if (!sug || sug.lat == null || sug.lon == null) {
      openPinFromReview();
      return;
    }
    if (!state.audit) state.audit = {};
    state.audit.geocode_confirmed = true;
    applyPin(sug.lat, sug.lon, "geocoded");
  }

  function handleReviewCta(action, formId) {
    if (action === "pin") openPinFromReview();
    else if (action === "accept-geo") acceptGeocodeSuggestion();
    else if (action === "apply-tiv") applyReviewTiv();
    else if (action === "apply-gfa") applyReviewGfa();
    else if (action === "apply-floors") applyReviewFloors();
    else if (action === "apply-height") applyReviewHeight();
    else if (action === "adjust") openAdjustForField(formId);
  }

  function openAdjustForField(formId) {
    closeReviewModal("adjust");
    openAdjustView(formId);
  }

  function ingestPayload(data) {
    if (!data) return window.emptyParse();
    const copy = Object.assign({}, data);
    delete copy.extracted_text;
    if (copy.canonical) return copy.canonical;
    if (copy.audit && copy.coordinates) return copy;
    return fromExtractApi(copy);
  }

  function applyParse(payload) {
    if (payload && typeof payload.extracted_text === "string" && payload.extracted_text.trim()) {
      rawSlip = payload.extracted_text;
      const slipEl = document.getElementById("slip");
      if (slipEl) slipEl.value = payload.extracted_text;
    }
    state = JSON.parse(JSON.stringify(ingestPayload(payload)));
    digested = true;
    intakeLocked = true;
    adjusting = false;
    pendingOverrides = null;
    fillForm();
    persistIntakeLock();
    const panel = document.getElementById("digest-panel");
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    enrichGeocodeSuggestion().then(function () {
      persistIntakeLock();
      if (IS_REVIEW) renderPageMissing();
      else openReviewIfNeeded();
    });
  }

  function settleReviewAfterPin() {
    reviewAwaitingPin = false;
    const remaining = wizardGaps();
    if (!remaining.length) {
      if (isReviewOpen()) closeReviewModal("filled");
      return;
    }
    openReviewModal();
  }

  function applyPin(lat, lon, source) {
    const pinLat = roundCoord(lat);
    const pinLon = roundCoord(lon);
    pendingOverrides = { lat: pinLat, lon: pinLon };
    setField("coordinates.lat", pinLat, source || "human");
    setField("coordinates.lon", pinLon, source || "human");
    if (state.audit) {
      state.audit.is_blocked = false;
      state.audit.block_reasons = [];
    }
    fillForm();
    persistIntakeLock();
    settleReviewAfterPin();
    if (rawSlip) {
      const confirmed = Boolean(state.audit && state.audit.geocode_confirmed);
      const suggestion = state.audit && state.audit.geocode_suggestion;
      postParseSlip(rawSlip, null, pendingOverrides).then(function (data) {
        state = JSON.parse(JSON.stringify(ingestPayload(data)));
        digested = true;
        if (!state.audit) state.audit = {};
        if (confirmed) state.audit.geocode_confirmed = true;
        if (suggestion) state.audit.geocode_suggestion = suggestion;
        fillForm();
        persistIntakeLock();
        settleReviewAfterPin();
      }).catch(function () {});
    }
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
    persistIntakeLock();
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

  async function postParseSlip(text, file, overrides) {
    let res;
    if (file) {
      const form = new FormData();
      form.append("file", file);
      if (text) form.append("text", text);
      if (overrides) form.append("overrides", JSON.stringify(overrides));
      res = await fetch(API_BASE + "/api/intake/parse-slip", {
        method: "POST",
        body: form
      });
    } else {
      res = await fetch(API_BASE + "/api/intake/parse-slip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text, overrides: overrides || {} })
      });
    }
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      throw new Error(data.error || data.details || "Parse failed (" + res.status + ")");
    }
    return data;
  }

  async function extract() {
    const slipEl = document.getElementById("slip");
    let pasted = slipEl ? slipEl.value.trim() : "";
    if (/^\(file\)\s+.+\s+[—\-].*upload/i.test(pasted)) pasted = "";
    rawSlip = pasted;
    const btn = document.getElementById("extract-btn");
    if (!pendingFile && !rawSlip) {
      toast("Paste a slip or drop a file first.", true);
      return;
    }
    extracting = true;
    btn.disabled = true;
    document.getElementById("extract-spinner").classList.remove("hidden");
    try {
      const data = await postParseSlip(rawSlip, pendingFile, null);
      pendingFile = null;
      applyParse(data);
      toast("Parsed by the intake engine.");
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
      const gpsMissing = getLat() == null || getLon() == null;
      if (IS_REVIEW) {
        if (gpsMissing) window.MapModal.open();
        else {
          const card = byId("page-missing-card");
          if (card && !card.classList.contains("hidden")) {
            card.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
        return;
      }
      if (!openReviewIfNeeded() && gpsMissing) window.MapModal.open();
      return;
    }

    // Build the full canonical record from the input form
    const propName = (typeof state.property_name === "object" ? state.property_name.value : state.property_name) ||
      (byId("property_name") && byId("property_name").textContent !== "No risk loaded" ? byId("property_name").textContent : "Landmark Plaza Commercial Development");
    const refCode = (typeof state.reference === "object" ? state.reference.value : state.reference) ||
      (byId("reference") && byId("reference").textContent ? byId("reference").textContent : "EIB-NAI-LP-2026-001");

    const canonicalRecord = {
      property_name: propName,
      reference: refCode,
      coordinates: {
        lat: { value: getLat(), source: field(state, "coordinates.lat.source") || "human" },
        lon: { value: getLon(), source: field(state, "coordinates.lon.source") || "human" },
        elevation_m: { value: num(field(state, "coordinates.elevation_m.value")), source: field(state, "coordinates.elevation_m.source") || "class_default" },
        elevation_m_dem: field(state, "coordinates.elevation_m_dem.value") != null ? { value: num(field(state, "coordinates.elevation_m_dem.value")), source: "dem" } : null
      },
      exposure: {
        housing_class: { value: field(state, "exposure.housing_class.value"), source: field(state, "exposure.housing_class.source") || "human" },
        occupancy: { value: field(state, "exposure.occupancy.value") || "commercial", source: field(state, "exposure.occupancy.source") || "derived" },
        floor_area_m2: { value: num(field(state, "exposure.floor_area_m2.value")), source: field(state, "exposure.floor_area_m2.source") || "human" },
        floors_above_ground: { value: num(field(state, "exposure.floors_above_ground.value")), source: field(state, "exposure.floors_above_ground.source") || "human" },
        total_height_m: { value: num(field(state, "exposure.total_height_m.value")), source: field(state, "exposure.total_height_m.source") || "implied" },
        basement_floors: { value: num(field(state, "exposure.basement_floors.value")) || 0, source: field(state, "exposure.basement_floors.source") || "human" },
        first_floor_height_m: num(field(state, "exposure.first_floor_height_m.value")),
        critical_plant_in_basement: { value: Boolean(field(state, "exposure.critical_plant_in_basement.value")), source: field(state, "exposure.critical_plant_in_basement.source") || "human" },
        tiv_kes: { value: num(field(state, "exposure.tiv_kes.value")), source: field(state, "exposure.tiv_kes.source") || "human" },
        cost_per_m2_kes: { value: impliedRate() || num(field(state, "exposure.cost_per_m2_kes.value")), source: field(state, "exposure.cost_per_m2_kes.source") || "implied" }
      },
      coverage: {
        class_of_business: { value: field(state, "coverage.class_of_business.value") || "Commercial Property", source: field(state, "coverage.class_of_business.source") || "class_default" },
        coverage_type: { value: field(state, "coverage.coverage_type.value") || "All-Risks (excluding flood)", source: field(state, "coverage.coverage_type.source") || "class_default" },
        flood_cover_requested: { value: true, source: "extracted" },
        cover_subject: { value: field(state, "coverage.cover_subject.value") || "both", source: field(state, "coverage.cover_subject.source") || "derived" },
        insured_interest: Array.isArray(state.coverage && state.coverage.insured_interest) ? state.coverage.insured_interest : ["owner/lessor", "occupying tenants"]
      },
      financial_terms: {
        deductible_pct: { value: num(field(state, "financial_terms.deductible_pct.value")), source: field(state, "financial_terms.deductible_pct.source") || "human" },
        deductible_min_kes: { value: num(field(state, "financial_terms.deductible_min_kes.value")), source: field(state, "financial_terms.deductible_min_kes.source") || "human" },
        policy_limit_kes: { value: num(field(state, "financial_terms.policy_limit_kes.value")), source: field(state, "financial_terms.policy_limit_kes.source") || "human" },
        vital_considerations: Array.isArray(state.financial_terms && state.financial_terms.vital_considerations) ? state.financial_terms.vital_considerations : []
      },
      audit: {
        is_blocked: false,
        block_reasons: [],
        warnings: Array.isArray(state.audit && state.audit.warnings) ? state.audit.warnings : []
      }
    };

    // 1. SAVE TO FIRESTORE DATABASE
    try {
      toast("Saving risk record to Firestore database...");
      if (window.CatNetFirebase && typeof window.CatNetFirebase.saveExposureToFirestore === "function") {
        await window.CatNetFirebase.saveExposureToFirestore(canonicalRecord);
        toast("Saved to Firestore & handing off to catastrophe engine.");
      }
    } catch (saveErr) {
      console.warn("Firestore database save warning:", saveErr);
    }
    const body = payload();
    try {
      toast("Running catastrophe model engine...");
      const res = await fetch(API_BASE + "/api/model/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(canonicalRecord),
      });
      if (!res.ok) throw new Error("Catastrophe engine returned HTTP " + res.status);
      const modelData = await res.json();
      console.log("✅ [Model Run] Retrieved catastrophe results from database:", modelData);
      sessionStorage.setItem("kenyaReResults", JSON.stringify(modelData));
      sessionStorage.setItem("kenyaReHandoff", JSON.stringify(modelData.exposure || body));

      const pml100 = modelData.results?.metrics?.pml_100y_kes != null ? fmtKes(modelData.results.metrics.pml_100y_kes) : "—";
      const aal = modelData.results?.metrics?.aal_ground_up_kes != null ? fmtKes(modelData.results.metrics.aal_ground_up_kes) : "—";
      toast("Run complete! Retrieved from DB: AAL KES " + aal + " · PML-100 KES " + pml100);
      showHandoff(modelData);
    } catch (err) {
      console.warn("Notice: Cat model offline fallback:", err.message);
      showHandoff(body);
    }
  }

  function showHandoff(body) {
    try {
      sessionStorage.setItem("kenyaReHandoff", JSON.stringify(body));
    } catch (_) {}
    window.location.href = "analysis.html";
  }

  function toast(msg, danger) {
    const el = document.getElementById("toast");
    if (!el) return;
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
    document.querySelectorAll(".kpi-why").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const next = btn.getAttribute("aria-expanded") !== "true";
        btn.setAttribute("aria-expanded", next ? "true" : "false");
        const panel = document.getElementById(btn.getAttribute("aria-controls"));
        if (panel) panel.hidden = !next;
      });
    });
    function listen(id, type, fn) {
      const node = byId(id);
      if (node) node.addEventListener(type, fn);
    }
    ["lat", "lon", "elev"].forEach(function (id) {
      listen(id, "change", function (e) {
        const path =
          id === "elev"
            ? "coordinates.elevation_m"
            : "coordinates." + (id === "lat" ? "lat" : "lon");
        onHuman(path, e.target.value, "num");
      });
    });
    listen("housing_class", "change", function (e) {
      onHuman("exposure.housing_class", e.target.value);
    });
    listen("floors", "change", function (e) {
      onHuman("exposure.floors_above_ground", e.target.value, "num");
      fillForm();
    });
    listen("basements", "change", function (e) {
      onHuman("exposure.basement_floors", e.target.value, "num");
      fillForm();
    });
    listen("height", "change", function (e) {
      onHuman("exposure.total_height_m", e.target.value, "num");
    });
    listen("plinth", "change", function (e) {
      onHuman("exposure.first_floor_height_m", e.target.value, "num");
      fillForm();
    });
    listen("plant", "change", function (e) {
      setField("exposure.critical_plant_in_basement", e.target.checked, "human");
      renderPlantWarning();
      renderStack();
      renderProfile();
      persistIntakeLock();
    });
    listen("tiv", "change", function (e) {
      onHuman("exposure.tiv_kes", e.target.value, "kes");
      e.target.value = fmtKes(parseKes(e.target.value));
      fillForm();
    });
    listen("gfa", "change", function (e) {
      onHuman("exposure.floor_area_m2", e.target.value, "num");
      fillForm();
    });
    document.querySelectorAll('input[name="cover_subject"]').forEach(function (r) {
      r.addEventListener("change", function (e) {
        onHuman("coverage.cover_subject", e.target.value);
      });
    });
    listen("ded_pct", "change", function (e) {
      onHuman("financial_terms.deductible_pct", e.target.value, "pct");
    });
    listen("ded_min", "change", function (e) {
      onHuman("financial_terms.deductible_min_kes", e.target.value, "kes");
      e.target.value = fmtKes(parseKes(e.target.value));
    });
    listen("limit", "change", function (e) {
      onHuman("financial_terms.policy_limit_kes", e.target.value, "kes");
      e.target.value = fmtKes(parseKes(e.target.value));
    });
    listen("unlock-edit-btn", "click", unlockIntake);

    const slipInput = document.getElementById("slip");
    if (slipInput) {
      slipInput.addEventListener("input", function () {
        pendingFile = null;
      });
    }
    const blockerPin = document.getElementById("blocker-pin-btn");
    if (blockerPin) {
      blockerPin.addEventListener("click", window.MapModal.open);
    }
    const extractBtn = document.getElementById("extract-btn");
    if (extractBtn) extractBtn.addEventListener("click", extract);
    const pinBtn = document.getElementById("pin-btn");
    if (pinBtn) pinBtn.addEventListener("click", window.MapModal.open);
    const mapClose = window.MapModal.close;
    window.MapModal.close = function () {
      mapClose();
      if (reviewAwaitingPin) {
        reviewAwaitingPin = false;
        if (IS_REVIEW) renderPageMissing();
        else if (wizardGaps().length) openReviewModal();
      }
    };
    listen("map-close", "click", window.MapModal.close);
    const mapModal = byId("map-modal");
    if (mapModal) {
      mapModal.addEventListener("click", function (e) {
        if (e.target.id === "map-modal") window.MapModal.close();
      });
    }
    const reviewClose = document.getElementById("review-close");
    if (reviewClose) {
      reviewClose.addEventListener("click", function () {
        closeReviewModal("close");
      });
    }
    const reviewSkip = document.getElementById("review-skip-btn");
    if (reviewSkip) {
      reviewSkip.addEventListener("click", skipWizardQuestion);
    }
    const reviewCard = document.getElementById("review-card");
    if (reviewCard) {
      reviewCard.addEventListener("click", function (e) {
        const cta = e.target.closest("[data-review-cta]");
        if (!cta) return;
        const action = cta.getAttribute("data-review-cta");
        handleReviewCta(action, cta.getAttribute("data-form-id"));
      });
      reviewCard.addEventListener("change", function (e) {
        if (e.target && e.target.id === "review-in-class") applyReviewClass();
      });
      reviewCard.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        if (e.target && e.target.id === "review-in-tiv") {
          e.preventDefault();
          applyReviewTiv();
        } else if (e.target && e.target.id === "review-in-gfa") {
          e.preventDefault();
          applyReviewGfa();
        } else if (e.target && e.target.id === "review-in-floors") {
          e.preventDefault();
          applyReviewFloors();
        } else if (e.target && e.target.id === "review-in-height") {
          e.preventDefault();
          applyReviewHeight();
        }
      });
    }
    const reviewModal = document.getElementById("review-modal");
    if (reviewModal) {
      reviewModal.addEventListener("click", function (e) {
        if (e.target.id === "review-modal") closeReviewModal("scrim");
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      const mapEl = document.getElementById("map-modal");
      if (mapEl && !mapEl.classList.contains("hidden")) {
        window.MapModal.close();
        return;
      }
      if (isReviewOpen()) closeReviewModal("esc");
    });
    listen("geocode-go", "click", window.MapModal.searchAddress);
    listen("geocode-q", "keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        window.MapModal.searchAddress();
      }
    });
    const pageMissing = byId("page-missing");
    if (pageMissing) {
      pageMissing.addEventListener("click", function (e) {
        const cta = e.target.closest("[data-review-cta]");
        if (!cta) return;
        const action = cta.getAttribute("data-review-cta");
        handleReviewCta(action, cta.getAttribute("data-form-id"));
      });
      pageMissing.addEventListener("change", function (e) {
        if (e.target && e.target.id === "review-in-class") applyReviewClass();
      });
      pageMissing.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        if (e.target && e.target.id === "review-in-tiv") {
          e.preventDefault();
          applyReviewTiv();
        } else if (e.target && e.target.id === "review-in-gfa") {
          e.preventDefault();
          applyReviewGfa();
        } else if (e.target && e.target.id === "review-in-floors") {
          e.preventDefault();
          applyReviewFloors();
        } else if (e.target && e.target.id === "review-in-height") {
          e.preventDefault();
          applyReviewHeight();
        }
      });
    }
    const newSlipBtn = document.getElementById("new-slip-btn");
    if (newSlipBtn) {
      newSlipBtn.addEventListener("click", function () {
        reviewAwaitingPin = false;
        closeReviewModal("reset");
        window.MapModal.close();
        digested = false;
        intakeLocked = false;
        adjusting = false;
        state = window.emptyParse();
        rawSlip = "";
        pendingFile = null;
        pendingOverrides = null;
        clearIntakeLock();
        const slipEl = document.getElementById("slip");
        if (slipEl) slipEl.value = "";
        const shell = document.getElementById("shell");
        if (shell) shell.classList.remove("digested-on");
        fillForm();
      });
    }
    const runBtn = document.getElementById("run-btn");
    if (runBtn) runBtn.addEventListener("click", runModel);
    const statusWrap = document.getElementById("status-wrap");
    if (statusWrap) {
      statusWrap.addEventListener("click", function () {
        if (this.dataset.blocked !== "1") return;
        if (getLat() == null || getLon() == null) window.MapModal.open();
      });
    }

    const drop = document.getElementById("dropzone");
    const file = document.getElementById("file");
    if (drop && file) {
      drop.addEventListener("click", function (e) {
        e.preventDefault();
        file.value = "";
        file.click();
      });
      drop.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          file.value = "";
          file.click();
        }
      });
      drop.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.add("border-[var(--accent)]");
      });
      drop.addEventListener("dragleave", function (e) {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.remove("border-[var(--accent)]");
      });
      drop.addEventListener("drop", function (e) {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.remove("border-[var(--accent)]");
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) readFile(f);
      });
      file.addEventListener("change", function (e) {
        const f = e.target.files && e.target.files[0];
        if (f) readFile(f);
      });
    }
  }

  function readFile(f) {
    pendingFile = f;
    const name = (f.name || "").toLowerCase();
    if (/\.(pdf|docx|xlsx|xls|png|jpe?g|webp)$/.test(name)) {
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

  async function syncWithDatabase() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const queryId = urlParams.get("id");
      let url = API_BASE + "/api/exposure";
      if (queryId) {
        url = API_BASE + "/api/exposure/" + encodeURIComponent(queryId);
      } else {
        url = API_BASE + "/api/exposure?limit=1";
      }

      const res = await fetch(url);
      if (!res.ok) return false;
      const data = await res.json();
      const record = Array.isArray(data) ? data[0] : data;
      if (!record || (!record.property_name && !record.coordinates)) return false;

      applyParse(record);
      const name = (typeof record.property_name === "object" ? record.property_name.value : record.property_name) || "risk profile";
      toast("Retrieved '" + name + "' from database.");
      return true;
    } catch (e) {
      console.warn("[Database Sync] Notice:", e.message);
      return false;
    }
  }

  // Hook all 'Review & complete' links to pass the active risk ID and persist to DB
  document.querySelectorAll('a[href*="review.html"]').forEach(function (link) {
    link.addEventListener("click", function () {
      if (digested) {
        const ref = (typeof state.reference === "object" ? state.reference.value : state.reference) || "";
        if (ref) {
          link.href = "review.html?id=" + encodeURIComponent(ref);
        }
      }
    });
  });

  window.KENYARE_API = API_BASE;
  window.IntakeApp = {
    applyPin: applyPin,
    getLat: getLat,
    getLon: getLon,
    payload: payload,
    syncWithDatabase: syncWithDatabase
  };

  bind();
  const hasLock = restoreIntakeLock();
  if (!hasLock) fillForm();

  // If on Review page, retrieve the record from the database
  if (IS_REVIEW) {
    const urlParams = new URLSearchParams(window.location.search);
    if (!hasLock || urlParams.has("id")) {
      syncWithDatabase().then(function (loaded) {
        const id = (location.hash || "").replace(/^#/, "");
        if (id) openAdjustView(id);
      });
    } else {
      const id = (location.hash || "").replace(/^#/, "");
      if (id) openAdjustView(id);
    }
  }
})();
