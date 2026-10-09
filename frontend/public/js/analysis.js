/**
 * Analysis frontend — four-module CAT desk (hazard → vulnerability → exposure → finance).
 * Shared storm rail (2 / 5 / 10 / 50 / 100). Each step changes the metric.
 * Hazard: is this pin wet? Vulnerability: how badly does the class fail?
 * Exposure: TIV × DR. Finance: write / AAL / PML 100y / EP.
 * Does not invent TIFF scores. Sample layout never pretends to have them.
 *
 * Teammate contract (POST /api/model/run → { exposure, results }):
 *   results.ep_curve[]  return_period, aep, flood_depth_m, damage_ratio,
 *                       ground_up_loss_kes, net_loss_kes
 *                       optional: susceptibility_score, h_max_m
 *   results.metrics     aal_net_kes, aal_ground_up_kes, pml_100y_kes, pml_250y_kes, rate_on_line_pct
 *   results.hazard_summary  nearby_hotspot, score_source, score_distance_km, depth_method
 * Aliases are accepted so the CAT engine can rename fields without breaking this page.
 */
(function () {
  const API_BASE = location.port === "5173" ? "http://127.0.0.1:3000" : "";

  const CLASS_LABELS = {
    informal_iron_sheet: "Informal mabati",
    semi_permanent: "Semi-permanent",
    permanent_masonry: "Masonry stone",
    concrete_rcc: "Commercial RCC"
  };

  const H_MAX_M = { 2: 0.5, 5: 0.8, 10: 1.2, 50: 1.8, 100: 2.2 };
  const RAIL_RPS = [2, 5, 10, 50, 100];
  const STORM_NAMES = { 2: "Common", 5: "Occasional", 10: "Moderate", 50: "Severe", 100: "Extreme" };

  const VULN_CURVES = {
    informal_iron_sheet: { K: 0.9, S0: 0.3, k: 3.5 },
    semi_permanent: { K: 0.85, S0: 0.6, k: 2.8 },
    permanent_masonry: { K: 0.75, S0: 1.0, k: 2.2 },
    concrete_rcc: { K: 0.65, S0: 1.5, k: 1.6 }
  };

  function hMaxFor(rp) {
    return H_MAX_M[rp] != null ? H_MAX_M[rp] : null;
  }

  function depthFromScore(rp, score) {
    if (score == null) return null;
    if (score <= 0) return 0;
    const h = hMaxFor(rp);
    if (h == null) return null;
    return Math.round(h * score * 100) / 100;
  }

  function damageRatioAt(depth, classKey) {
    if (depth == null) return null;
    if (depth <= 0) return 0;
    const curve = VULN_CURVES[classKey] || VULN_CURVES.concrete_rcc;
    const dr = curve.K / (1 + Math.exp(-curve.k * (depth - curve.S0)));
    return Math.min(Math.max(dr, 0), curve.K);
  }

  function realScorePoints(ctx) {
    if (!ctx || ctx.isSample || ctx.scoreSource === "sample") return [];
    return (ctx.curve || []).filter(function (p) {
      return p.susceptibility_score != null || p.damage_ratio != null || p.flood_depth_m != null;
    });
  }

  function vulnDerived(ctx) {
    return realScorePoints(ctx).map(function (p) {
      const score = p.susceptibility_score;
      const hmax = p.h_max_m != null ? p.h_max_m : hMaxFor(p.return_period);
      const derived =
        score == null || hmax == null ? null : score <= 0 ? 0 : Math.round(hmax * score * 100) / 100;
      const depth = p.flood_depth_m != null ? p.flood_depth_m : derived;
      const dr = p.damage_ratio != null ? p.damage_ratio : damageRatioAt(depth, ctx.classKey);
      return {
        return_period: p.return_period,
        susceptibility_score: score,
        h_max_m: hmax,
        flood_depth_m: depth,
        damage_ratio: dr,
        ground_up_loss_kes: p.ground_up_loss_kes,
        net_loss_kes: p.net_loss_kes
      };
    });
  }

  function unwrap(node) {
    if (node == null) return { value: null, source: null };
    if (typeof node === "object" && "value" in node) {
      return { value: node.value, source: node.source || null };
    }
    return { value: node, source: null };
  }

  function pick(obj, path) {
    const parts = path.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
      if (cur == null) return { value: null, source: null };
      cur = cur[parts[i]];
    }
    return unwrap(cur);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isBlank(v) {
    return v == null || v === "" || (typeof v === "number" && !isFinite(v));
  }

  function num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  function fmtKes(n, empty) {
    if (n == null || isNaN(n)) return empty || "not found";
    const abs = Math.abs(n);
    if (abs >= 1e9) return "KES " + (n / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return "KES " + (n / 1e6).toFixed(2) + "M";
    return "KES " + Math.round(n).toLocaleString("en-KE");
  }

  function fmtKesFull(n) {
    if (n == null || isNaN(n)) return "not found";
    return "KES " + Math.round(n).toLocaleString("en-KE");
  }

  function fmtPct(n, digits) {
    if (n == null || isNaN(n)) return "not found";
    return n.toFixed(digits == null ? 2 : digits) + "%";
  }

  function badge(source) {
    if (!source) return "";
    return '<span class="badge badge-' + escapeHtml(source) + '">' + escapeHtml(source) + "</span>";
  }

  function nf(text) {
    return '<span class="nf">' + escapeHtml(text || "not found") + "</span>";
  }

  function parseRun(raw) {
    if (!raw || typeof raw !== "object") return null;
    const exposure = raw.exposure || (raw.model_results ? raw : null);
    const results = raw.results || (exposure && exposure.model_results) || raw.model_results || null;
    if (!exposure && !results) return null;
    return { exposure: exposure || {}, results: results || null, raw: raw };
  }

  function firstNum(obj, keys) {
    if (!obj) return null;
    for (let i = 0; i < keys.length; i++) {
      const n = num(obj[keys[i]]);
      if (n != null) return n;
    }
    return null;
  }

  function normalizePoint(p) {
    if (!p || typeof p !== "object") return null;
    const rp = firstNum(p, ["return_period", "return_period_years", "rp", "returnPeriod"]);
    if (rp == null) return null;
    const loss = p.loss && typeof p.loss === "object" ? p.loss : {};
    return {
      tier: p.tier || null,
      return_period: rp,
      aep: firstNum(p, ["aep", "annual_exceedance_probability", "exceedance_prob", "exceedanceProbability"]),
      susceptibility_score: firstNum(p, [
        "susceptibility_score",
        "susceptibility",
        "hazard_score",
        "tiff_score",
        "score"
      ]),
      h_max_m: firstNum(p, ["h_max_m", "h_max", "hMax", "assumed_max_depth_m", "max_depth_m"]),
      flood_depth_m: firstNum(p, ["flood_depth_m", "estimated_depth_m", "depth_m", "local_depth_m", "depth"]),
      damage_ratio: firstNum(p, ["damage_ratio", "dr", "damageRatio"]) || firstNum(p.damage || {}, ["damage_ratio"]),
      ground_up_loss_kes: firstNum(p, [
        "ground_up_loss_kes",
        "ground_up",
        "groundUpLoss"
      ]) || firstNum(loss, ["gross_damage_kes"]),
      deductible_kes: firstNum(p, ["deductible_kes", "deductible"]) || firstNum(loss, ["deductible_kes"]),
      net_loss_kes: firstNum(p, ["net_loss_kes", "net", "gross_loss_kes", "netLoss", "insured_loss_kes"]) || firstNum(loss, ["insured_loss_kes", "net_loss_kes"])
    };
  }

  function normalizeCurve(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map(normalizePoint)
      .filter(Boolean)
      .sort(function (a, b) {
        return a.return_period - b.return_period;
      });
  }

  function sampleRun() {
    return {
      sample: true,
      exposure: {
        property_name: "Sample · Westlands commercial (layout only)",
        reference: "SAMPLE-UI",
        coordinates: {
          lat: { value: -1.2647, source: "human" },
          lon: { value: 36.8044, source: "human" },
          elevation_m: { value: 1690, source: "dem" }
        },
        exposure: {
          housing_class: { value: "concrete_rcc", source: "extracted" },
          occupancy: { value: "commercial", source: "derived" },
          floor_area_m2: { value: 24500, source: "extracted" },
          floors_above_ground: { value: 18, source: "extracted" },
          total_height_m: { value: 64.8, source: "extracted" },
          basement_floors: { value: 2, source: "extracted" },
          critical_plant_in_basement: { value: true, source: "extracted" },
          tiv_kes: { value: 1090000000, source: "extracted" }
        },
        coverage: {
          cover_subject: { value: "both", source: "derived" },
          coverage_type: { value: "All-Risks", source: "extracted" }
        },
        financial_terms: {
          deductible_pct: { value: 0.05, source: "extracted" },
          deductible_min_kes: { value: 5000000, source: "extracted" },
          policy_limit_kes: { value: 1090000000, source: "extracted" }
        },
        audit: { extracted_address: "Ring Road Westlands, Nairobi" }
      },
      results: {
        hazard_summary: {
          nearby_hotspot: "Westlands / Ojijo Rd",
          score_source: null
        },
        metrics: {
          aal_ground_up_kes: 9800000,
          aal_net_kes: 7200000,
          pml_100y_kes: 28000000,
          pml_250y_kes: 38000000,
          rate_on_line_pct: 0.66
        },
        ep_curve: [
          { return_period: 2, aep: 0.5, damage_ratio: 0.06, ground_up_loss_kes: 3000000, net_loss_kes: 0 },
          { return_period: 5, aep: 0.2, damage_ratio: 0.11, ground_up_loss_kes: 8000000, net_loss_kes: 3000000 },
          { return_period: 10, aep: 0.1, damage_ratio: 0.18, ground_up_loss_kes: 16000000, net_loss_kes: 11000000 },
          { return_period: 50, aep: 0.02, damage_ratio: 0.32, ground_up_loss_kes: 28000000, net_loss_kes: 23000000 },
          { return_period: 100, aep: 0.01, damage_ratio: 0.44, ground_up_loss_kes: 38000000, net_loss_kes: 33000000 }
        ],
        ai_metrics: {
          aal_ground_up_kes: 14200000,
          aal_net_kes: 10800000,
          pml_100y_kes: 41000000
        },
        ai_ep_curve: [
          { return_period: 2, aep: 0.5, damage_ratio: 0.1, ground_up_loss_kes: 5200000, net_loss_kes: 200000 },
          { return_period: 5, aep: 0.2, damage_ratio: 0.16, ground_up_loss_kes: 11800000, net_loss_kes: 6800000 },
          { return_period: 10, aep: 0.1, damage_ratio: 0.24, ground_up_loss_kes: 22000000, net_loss_kes: 17000000 },
          { return_period: 50, aep: 0.02, damage_ratio: 0.38, ground_up_loss_kes: 34000000, net_loss_kes: 29000000 },
          { return_period: 100, aep: 0.01, damage_ratio: 0.5, ground_up_loss_kes: 46000000, net_loss_kes: 41000000 }
        ],
        ai_upgrade: {
          applied: true,
          reason: "blinded_drainage_corridor",
          radius_km: 2,
          surcharge: { type: "susceptibility_add", value: 0.28 },
          classification_source: "kit_labels",
          blinded_count: 4,
          hit_count: 6,
          nearest_blinded: { name: "Westlands", distance_km: 0.4, class: "blinded" },
          drainage_evidence: true,
          briefing:
            "Sample layout. TIFF proxy misses Westlands (drainage overload). AI surcharge +0.28 susceptibility changes AAL. News is not a gauge.",
          sources: [
            { title: "The Star, 15 March 2026", what: "37 flood-prone neighbourhoods", url: "https://www.the-star.co.ke" },
            { title: "Kenya Climate Directory, 2024", what: "Drainage capacity diagnostic", url: "https://kenyaclimatedirectory.org" },
            { title: "JRC / Huizinga", what: "Depth–damage shape", url: "https://publications.jrc.ec.europa.eu" }
          ],
          assumptions: [
            "Sample numbers — not a live run.",
            "Upgrade radius is 2 km from a blinded hotspot.",
            "susceptibility_ai = min(1, base + 0.28).",
            "News is not a street gauge."
          ]
        }
      }
    };
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  }

  function runHasOutput(run) {
    if (!run || !run.results) return false;
    const res = run.results;
    return Boolean(
      (res.ep_curve && res.ep_curve.length) ||
        (res.scenarios && res.scenarios.length) ||
        res.metrics ||
        res.ai_upgrade
    );
  }

  function bundleToRun(id, bundle) {
    if (!bundle) return null;
    const input = bundle.input || {};
    const output = bundle.output || {};
    const results = bundle.results || output.results || output;
    window.__kenyaReSessionPair = { id: id, input: input, output: output };
    return {
      exposure: input,
      results: results && typeof results === "object" ? results : null,
      raw: { id: id, input: input, output: output }
    };
  }

  async function fetchSessionRun(id) {
    let session = await fetchJson(API_BASE + "/api/session/" + encodeURIComponent(id));
    if (!session || (!session.input && !session.output)) {
      const input = await fetchJson(API_BASE + "/api/exposure/" + encodeURIComponent(id));
      const output = await fetchJson(API_BASE + "/api/model/" + encodeURIComponent(id));
      session = { id: id, input: input, output: output };
    }
    if (!session || (!session.input && !session.output)) return null;
    return bundleToRun(session.id || id, session);
  }

  async function loadRun() {
    const q = new URLSearchParams(location.search);
    if (q.get("sample") === "1" || q.get("sample") === "true") {
      return parseRun(sampleRun());
    }

    const id = (window.KenyaReSession && window.KenyaReSession.get()) || q.get("id");
    if (!id) return null;

    const fresh = window.KenyaReSession && window.KenyaReSession.getFreshRun(id);
    if (fresh) {
      const fromFresh = bundleToRun(id, fresh);
      if (runHasOutput(fromFresh)) return fromFresh;
    }

    try {
      const sessionRun = await fetchSessionRun(id);
      if (sessionRun && window.KenyaReSession) window.KenyaReSession.set(id);
      return sessionRun;
    } catch (e) {
      console.warn("Analysis: session load failed", e);
      return null;
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function waitForRun(id, meta) {
    if (window.KenyaReSession) {
      window.KenyaReSession.showAgg(meta || {});
    }
    const started = Date.now();
    while (Date.now() - started < 90000) {
      const fresh = window.KenyaReSession && window.KenyaReSession.getFreshRun(id);
      if (fresh) {
        const fromFresh = bundleToRun(id, fresh);
        if (runHasOutput(fromFresh)) return fromFresh;
      }
      try {
        const sessionRun = await fetchSessionRun(id);
        if (runHasOutput(sessionRun)) return sessionRun;
      } catch (_) {}
      await sleep(700);
    }
    return null;
  }

  function gpsKind(exp) {
    const lat = pick(exp, "coordinates.lat");
    const lon = pick(exp, "coordinates.lon");
    if (isBlank(lat.value) || isBlank(lon.value)) {
      return { kind: "missing", label: "not found", source: lat.source || lon.source };
    }
    const src = lat.source || lon.source;
    const confirmed = Boolean(exp.audit && exp.audit.geocode_confirmed);
    if (src === "extracted") return { kind: "confirmed", label: "Confirmed · slip GPS", source: src };
    if (src === "human") return { kind: "pinned", label: "Pinned by underwriter", source: src };
    if (src === "geocoded" && confirmed) return { kind: "confirmed", label: "Confirmed · geocode", source: src };
    if (src === "geocoded") return { kind: "geocoded", label: "Geocoded · confirm on Review", source: src };
    return { kind: "present", label: "On file", source: src };
  }

  function findShare(exp) {
    const paths = [
      "financial_terms.share_pct",
      "financial_terms.quota_share_pct",
      "financial_terms.kenya_re_share_pct",
      "coverage.share_pct",
      "coverage.ceded_share_pct"
    ];
    for (let i = 0; i < paths.length; i++) {
      const hit = pick(exp, paths[i]);
      if (!isBlank(hit.value)) return hit;
    }
    return { value: null, source: null };
  }

  function constructedTvar(curve, thresholdAep) {
    const tail = (curve || [])
      .filter(function (p) {
        return p.aep != null && p.aep <= thresholdAep && p.net_loss_kes != null;
      })
      .sort(function (a, b) {
        return b.aep - a.aep;
      });
    if (tail.length === 1) {
      return {
        value: tail[0].net_loss_kes,
        note: "Only one stated tail point (" + tail[0].return_period + "y). TVaR equals that net loss — not a continuous tail."
      };
    }
    if (tail.length < 2) {
      return {
        value: null,
        note: "Need at least two stated tail points. Continuous TVaR is not in the model payload."
      };
    }
    let acc = 0;
    let mass = 0;
    for (let i = 0; i < tail.length - 1; i++) {
      const dp = Math.abs(tail[i].aep - tail[i + 1].aep);
      acc += dp * ((tail[i].net_loss_kes + tail[i + 1].net_loss_kes) / 2);
      mass += dp;
    }
    if (!mass) return { value: null, note: "not found" };
    return {
      value: Math.round(acc / mass),
      note:
        "Constructed from stated net losses " +
        tail[0].return_period +
        "y–" +
        tail[tail.length - 1].return_period +
        "y, weighted by AEP span. Tail beyond the last RP is not modeled."
    };
  }

  function decide(ctx) {
    const holds = [];
    const conditions = [];

    if (!ctx.hasModel) holds.push("No catastrophe run on file");
    if (ctx.tiv == null) holds.push("TIV not found");
    if (ctx.gps.kind === "missing") holds.push("GPS not found");
    if (ctx.rol != null && ctx.rol > 2) holds.push("Rate on line above 2% of TIV");
    if (ctx.pml250Ratio != null && ctx.pml250Ratio > 0.2) holds.push("PML 250y exceeds 20% of TIV");
    if (ctx.limit == null) holds.push("Policy limit not found");

    if (ctx.aiApplied) {
      conditions.push(
        "AI drainage upgrade on a blinded hotspot — " +
          (ctx.aiHotspot || "named corridor") +
          ". Hazard TIFF is unchanged."
      );
    } else if (ctx.hotspotName) {
      conditions.push("Named corridor on file — check Finance for whether the TIFF was blinded");
    }
    if (ctx.dedSrc === "class_default" || ctx.dedMinSrc === "class_default") {
      conditions.push("Deductible is a class default, not slip-stated");
    }
    if (ctx.share == null) conditions.push("Share not found on the slip");
    if (ctx.gps.kind === "pinned") conditions.push("Location is pinned, not printed GPS");
    if (ctx.gps.kind === "geocoded") conditions.push("Location is geocoded, not yet confirmed");
    if (ctx.limitSrc === "class_default") conditions.push("Limit is a class default");
    if (ctx.plant) conditions.push("Critical plant sits in the basement");

    if (holds.length) {
      return { verdict: "HOLD", tone: "hold", why: holds.join(" · "), holds: holds, conditions: conditions };
    }
    if (conditions.length) {
      return {
        verdict: "WRITE · CONDITIONS",
        tone: "conditions",
        why: conditions.join(" · "),
        holds: holds,
        conditions: conditions
      };
    }
    return {
      verdict: "WRITE",
      tone: "write",
      why: "Net AAL and 100-year PML sit inside a modest wet-storey loss versus TIV. Screening aid — not a binding quote.",
      holds: holds,
      conditions: conditions
    };
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function renderDecision(ctx, decision) {
    const strip = document.getElementById("decision-verdict");
    const stamp = document.getElementById("decision-stamp");
    if (strip) strip.setAttribute("data-tone", decision.tone);
    if (stamp) stamp.textContent = decision.verdict;
    setText("dec-property", ctx.property || "not found");
    setText("dec-tiv", fmtKes(ctx.tiv));
    setText("dec-class", ctx.classLabel || "not found");
    setText("dec-aal", fmtKes(ctx.aalNet));
    setText("dec-pml", fmtKes(ctx.pml100));
    setText("decision-why", decision.why);
    setText("risk-name", ctx.property || "Unnamed risk");
    setText("risk-ref", ctx.reference || "");
    setText("session-id", ctx.sessionId ? "ID " + ctx.sessionId : "");
    const back = document.getElementById("back-review");
    if (back) back.setAttribute("href", reviewHref(ctx.sessionId));
  }

  function stormLabel(pt) {
    return STORM_NAMES[pt.return_period] || pt.tier || "Storm";
  }

  function hasRealScores(ctx) {
    if (!ctx || ctx.isSample || ctx.scoreSource === "sample") return false;
    return (ctx.curve || []).some(function (p) {
      return p.susceptibility_score != null;
    });
  }

  function isDryCell(ctx) {
    if (!hasRealScores(ctx)) return false;
    return (ctx.curve || [])
      .filter(function (p) {
        return p.susceptibility_score != null;
      })
      .every(function (p) {
        return p.susceptibility_score === 0;
      });
  }

  function pointByRp(ctx) {
    const map = {};
    (ctx.curve || []).forEach(function (p) {
      map[p.return_period] = Object.assign({}, p);
    });
    vulnDerived(ctx).forEach(function (p) {
      map[p.return_period] = Object.assign({}, map[p.return_period] || {}, p);
    });
    exposureRows(ctx).forEach(function (p) {
      map[p.return_period] = Object.assign({}, map[p.return_period] || {}, p);
    });
    return map;
  }

  function scorePill(label, value, tone, sub) {
    return (
      '<div class="score-pill score-pill-' +
      (tone || "warm") +
      '"><em>' +
      escapeHtml(String(label)) +
      "</em><strong>" +
      value +
      "</strong>" +
      (sub ? "<span class='score-sub'>" + sub + "</span>" : "") +
      "</div>"
    );
  }

  function fillPills(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function railCell(label, value, tone, sub) {
    return (
      '<div class="storm-cell storm-cell-' +
      (tone || "warm") +
      '"><em>' +
      escapeHtml(String(label)) +
      "</em><strong>" +
      value +
      "</strong>" +
      (sub ? "<span>" + sub + "</span>" : "") +
      "</div>"
    );
  }

  function renderStormRail(ctx, step) {
    if (!ctx) return;
    const host = document.getElementById("storm-rail-cells");
    const rail = document.getElementById("storm-rail");
    if (!host) return;
    const byRp = pointByRp(ctx);
    const dry = isDryCell(ctx);
    const scored = hasRealScores(ctx);
    let kicker = "Susceptibility";
    let note = "One score per storm at this pin.";
    if (step === "vulnerability") {
      kicker = "Depth and damage";
      note = "Metres from the score, then the class damage ratio.";
    } else if (step === "exposure") {
      kicker = "Ground-up loss";
      note = "TIV × damage ratio.";
    } else if (step === "finance") {
      kicker = "Net loss";
      note = "After deductible and limit.";
    }
    if (step === "hazard" || step === "vulnerability") {
      if (ctx.isSample) note = "Sample layout — no live scores on this pin.";
      else if (dry) note = "This cell is dry on all five maps.";
      else if (!scored) note = "Scores attach when the model has sampled this pin.";
    } else if (dry && (step === "exposure" || step === "finance")) {
      note = "Dry cell — losses stay at zero until a map is wet.";
    }
    setText("storm-rail-kicker", kicker);
    setText("storm-rail-note", note);
    if (rail) rail.setAttribute("data-state", dry ? "dry" : scored ? "wet" : "empty");

    host.innerHTML = RAIL_RPS.map(function (rp) {
      const pt = byRp[rp] || { return_period: rp };
      const name = rp + "y · " + (STORM_NAMES[rp] || "");
      if (step === "hazard") {
        if (ctx.isSample) return railCell(name, "—", "empty");
        const s = pt.susceptibility_score;
        if (s == null) return railCell(name, "—", "empty");
        return railCell(name, Number(s).toFixed(2), s === 0 ? "dry" : s >= 0.5 ? "hot" : "warm");
      }
      if (step === "vulnerability") {
        if (ctx.isSample && pt.flood_depth_m == null && pt.damage_ratio != null) {
          return railCell(name, Math.round(pt.damage_ratio * 100) + "%", "warm");
        }
        if (!scored && !ctx.isSample) return railCell(name, "—", "empty");
        const d = pt.flood_depth_m != null ? pt.flood_depth_m.toFixed(2) + " m" : "—";
        const dr = pt.damage_ratio != null ? Math.round(pt.damage_ratio * 100) + "%" : "";
        const tone =
          pt.damage_ratio != null && pt.damage_ratio >= 0.35 ? "hot" : pt.flood_depth_m === 0 ? "dry" : "warm";
        return railCell(name, d, tone, dr);
      }
      if (step === "exposure") {
        if (pt.ground_up_loss_kes == null) return railCell(name, "—", "empty");
        return railCell(name, fmtKes(pt.ground_up_loss_kes), pt.ground_up_loss_kes === 0 ? "dry" : "warm");
      }
      if (pt.net_loss_kes == null) return railCell(name, "—", "empty");
      return railCell(name, fmtKes(pt.net_loss_kes), pt.net_loss_kes === 0 ? "dry" : "warm");
    }).join("");
  }

  function reviewHref(sessionId) {
    if (window.KenyaReSession) return window.KenyaReSession.href("review.html");
    return sessionId ? "review.html?id=" + encodeURIComponent(sessionId) : "review.html";
  }

  function exposureRows(ctx) {
    const source = ctx.isSample ? ctx.curve || [] : vulnDerived(ctx);
    return source
      .map(function (pt) {
        const dr = pt.damage_ratio;
        const gu =
          pt.ground_up_loss_kes != null
            ? pt.ground_up_loss_kes
            : ctx.tiv != null && dr != null
              ? Math.round(ctx.tiv * dr)
              : null;
        return {
          return_period: pt.return_period,
          damage_ratio: dr,
          ground_up_loss_kes: gu,
          net_loss_kes: pt.net_loss_kes
        };
      })
      .filter(function (pt) {
        return pt.damage_ratio != null || pt.ground_up_loss_kes != null;
      });
  }

  function renderHazard(ctx) {
    const gpsTxt =
      ctx.lat != null && ctx.lon != null
        ? ctx.lat.toFixed(4) + ", " + ctx.lon.toFixed(4)
        : "not found";
    setText("haz-gps", gpsTxt);
    setText("haz-address", ctx.address || "Address not found");
    setText("haz-gps-kind", ctx.gps && ctx.gps.label ? ctx.gps.label : "");

    const dry = isDryCell(ctx);
    const scored = hasRealScores(ctx);
    const byRp = pointByRp(ctx);
    if (ctx.isSample) {
      fillPills("haz-score-pills", '<p class="nf">Sample layout — no live scores on this pin.</p>');
      setText("haz-drain-note", "This page will not invent TIFF scores.");
    } else if (!scored) {
      fillPills("haz-score-pills", '<p class="nf">Not found — waiting on scores for this pin.</p>');
      setText("haz-drain-note", "Scores attach when the model has sampled this pin.");
    } else {
      fillPills(
        "haz-score-pills",
        RAIL_RPS.map(function (rp) {
          const pt = byRp[rp] || {};
          const s = pt.susceptibility_score;
          const txt = s != null ? Number(s).toFixed(2) : "—";
          const tone = s == null ? "empty" : s === 0 ? "dry" : s >= 0.5 ? "hot" : "warm";
          return scorePill(rp + "y", txt, tone);
        }).join("")
      );
      setText(
        "haz-drain-note",
        dry
          ? "This cell is dry on all five maps."
          : "TIFF cell value (0–1) at this pin. Zero means dry."
      );
    }
    if (ctx.aiHotspot) {
      setText(
        "haz-blind-note",
        "Nearest blinded corridor: " +
          ctx.aiHotspot +
          (ctx.aiDistanceKm != null ? " · " + ctx.aiDistanceKm + " km" : "") +
          ". Hazard stays on the TIFF. Results holds the AI upgrade."
      );
    } else {
      setText("haz-blind-note", "");
    }
  }

  function renderAiFinance(ctx) {
    const panel = document.getElementById("ai-loss-panel");
    if (panel) panel.setAttribute("data-applied", ctx.aiApplied ? "true" : "false");
    const delta =
      ctx.aiAalNet != null && ctx.aalNet != null ? ctx.aiAalNet - ctx.aalNet : ctx.aiAalNet != null ? ctx.aiAalNet : null;
    setText("fin-base-aal", fmtKes(ctx.aalNet));
    setText("fin-ai-aal", fmtKes(ctx.aiAalNet != null ? ctx.aiAalNet : ctx.aalNet));
    setText(
      "fin-ai-delta",
      delta == null ? "not found" : (delta > 0 ? "+" : "") + fmtKes(delta)
    );
    setText("fin-ai-pml", fmtKes(ctx.aiPml100 != null ? ctx.aiPml100 : ctx.pml100));
    setText(
      "ai-loss-lede",
      ctx.aiApplied
        ? "AI changed the loss. Hazard TIFF is untouched."
        : "AI checked the blinded drainage corridors and left the loss equal to base."
    );
    setText(
      "ai-hotspot-note",
      ctx.aiHotspot
        ? (ctx.aiApplied ? "Upgrade fired on " : "Nearest blinded corridor: ") +
            ctx.aiHotspot +
            (ctx.aiDistanceKm != null ? " · " + ctx.aiDistanceKm + " km" : "")
        : "No blinded hotspot within the 2 km gate."
    );
    setText("ai-briefing", ctx.aiBriefing || "not found");
    const tbody = document.querySelector("#ai-sources tbody");
    if (tbody) {
      if (!ctx.aiSources.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="nf">not found</td></tr>';
      } else {
        tbody.innerHTML = ctx.aiSources
          .map(function (src) {
            const url = src.url || "";
            const link = url
              ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + escapeHtml(url) + "</a>"
              : "not found";
            return (
              "<tr><td>" +
              escapeHtml(src.title || src.id || "Source") +
              "</td><td>" +
              escapeHtml(src.what || "") +
              "</td><td>" +
              link +
              "</td></tr>"
            );
          })
          .join("");
      }
    }
    const list = document.getElementById("ai-assumptions");
    if (list) {
      if (!ctx.aiAssumptions.length) {
        list.innerHTML = "<li>not found</li>";
      } else {
        list.innerHTML = ctx.aiAssumptions
          .map(function (line) {
            return "<li>" + escapeHtml(line) + "</li>";
          })
          .join("");
      }
    }
  }

  function aiNetAt(ctx, rp) {
    const row = (ctx.aiCurve || []).filter(function (p) {
      return p.return_period === rp;
    })[0];
    return row ? row.net_loss_kes : null;
  }

  function renderResults(ctx) {
    renderAiFinance(ctx);
    setText("res-tiv", fmtKes(ctx.tiv));
    setText("res-tiv-src", ctx.tivSrc ? "Source: " + ctx.tivSrc + ". Facultative slip, not the synthetic book." : "TIV source not found.");
    setText("res-class", ctx.classLabel || "not found");
    const tbody = document.querySelector("#res-loss-table tbody");
    if (tbody) {
      const rows = ctx.curve || [];
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="nf">not found</td></tr>';
      } else {
        tbody.innerHTML = rows
          .map(function (pt) {
            const ai = aiNetAt(ctx, pt.return_period);
            return (
              "<tr><td>" +
              stormLabel(pt) +
              " · " +
              pt.return_period +
              "y</td><td>" +
              fmtKes(pt.net_loss_kes) +
              "</td><td>" +
              fmtKes(ai != null ? ai : pt.net_loss_kes) +
              "</td></tr>"
            );
          })
          .join("");
      }
    }
  }

  function downloadBriefing(ctx) {
    if (!ctx) return;
    const decision = decide(ctx);
    const tvar = ctx.tvar100 || {};
    const lines = [
      "Kenya Re · Nairobi facultative flood briefing",
      "Property: " + (ctx.property || "not found"),
      "Reference: " + (ctx.reference || "not found"),
      "Pin: " + (ctx.lat != null && ctx.lon != null ? ctx.lat.toFixed(4) + ", " + ctx.lon.toFixed(4) : "not found"),
      "GPS: " + ((ctx.gps && ctx.gps.label) || "not found"),
      "",
      "Decision: " + decision.verdict,
      decision.why || "",
      "",
      "Total exposure (TIV): " + fmtKesFull(ctx.tiv) + " (" + (ctx.tivSrc || "source not found") + ")",
      "Construction: " + (ctx.classLabel || "not found"),
      "This is one facultative risk, not the 600-row synthetic book.",
      "",
      "Finance (TIFF base)",
      "AAL net: " + fmtKesFull(ctx.aalNet),
      "PML 100y: " + fmtKesFull(ctx.pml100),
      "TVaR 100y: " + fmtKesFull(tvar.value),
      tvar.note || "",
      "",
      "Base vs AI-upgraded AAL: " +
        fmtKesFull(ctx.aalNet) +
        " → " +
        fmtKesFull(ctx.aiAalNet != null ? ctx.aiAalNet : ctx.aalNet),
      "AI PML 100y: " + fmtKesFull(ctx.aiPml100 != null ? ctx.aiPml100 : ctx.pml100),
      "Hotspot: " +
        (ctx.aiHotspot
          ? ctx.aiHotspot + (ctx.aiDistanceKm != null ? " · " + ctx.aiDistanceKm + " km" : "")
          : "none in the 2 km gate"),
      "",
      "Loss at stated return periods"
    ];
    (ctx.curve || []).forEach(function (pt) {
      const ai = aiNetAt(ctx, pt.return_period);
      lines.push(
        pt.return_period +
          "y base net " +
          fmtKesFull(pt.net_loss_kes) +
          " · AI net " +
          fmtKesFull(ai != null ? ai : pt.net_loss_kes)
      );
    });
    lines.push("");
    lines.push(ctx.aiBriefing || "");
    lines.push("");
    lines.push("Sources");
    (ctx.aiSources || []).forEach(function (src) {
      lines.push("- " + (src.title || src.id) + " — " + (src.what || "") + " — " + (src.url || ""));
    });
    lines.push("");
    lines.push("Assumptions");
    (ctx.aiAssumptions || []).forEach(function (line) {
      lines.push("- " + line);
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kenya-re-results-" + (ctx.reference || ctx.sessionId || "run") + ".txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function bindResultsDesk() {
    const dl = document.getElementById("results-download");
    if (dl && !dl.dataset.bound) {
      dl.dataset.bound = "1";
      dl.addEventListener("click", function () {
        downloadBriefing(lastCtx);
      });
    }
    const form = document.getElementById("results-chat-form");
    if (form && !form.dataset.bound) {
      form.dataset.bound = "1";
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        sendResultsChat();
      });
    }
  }

  async function sendResultsChat() {
    const input = document.getElementById("results-chat-input");
    const log = document.getElementById("results-chat-log");
    const q = input && input.value ? input.value.trim() : "";
    if (!q || !log) return;
    input.value = "";
    const qEl = document.createElement("p");
    qEl.className = "chat-q";
    qEl.textContent = q;
    log.appendChild(qEl);
    const wait = document.createElement("p");
    wait.className = "chat-a";
    wait.textContent = "…";
    log.appendChild(wait);
    log.scrollTop = log.scrollHeight;
    const pair = window.__kenyaReSessionPair || {};
    try {
      const res = await fetch(API_BASE + "/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          exposure: pair.input || (lastCtx && lastCtx.raw) || {},
          results: (pair.output && pair.output.results) || pair.output || {},
          history: []
        })
      });
      const data = await res.json().catch(function () {
        return {};
      });
      wait.textContent = data.answer || data.error || "No answer.";
    } catch (err) {
      wait.textContent = err.message || "Chat failed.";
    }
    log.scrollTop = log.scrollHeight;
  }

  function renderVulnerability(ctx) {
    lastVuln = { classKey: ctx.classKey, rows: vulnDerived(ctx) };
    const rows = ctx.isSample
      ? (ctx.curve || []).map(function (p) {
          return {
            return_period: p.return_period,
            susceptibility_score: null,
            h_max_m: hMaxFor(p.return_period),
            flood_depth_m: p.flood_depth_m,
            damage_ratio: p.damage_ratio
          };
        })
      : lastVuln.rows;

    const scored = hasRealScores(ctx);
    if (!rows.length && !ctx.isSample) {
      fillPills("vuln-score-pills", '<p class="nf">Waiting on Hazard scores.</p>');
      fillPills("vuln-out-pills", '<p class="nf">No depths until scores arrive.</p>');
      setText("vuln-in-note", "The five scores from Hazard, at this pin.");
      setText("vuln-out-note", "Outputs stay empty until Hazard has real scores.");
    } else {
      fillPills(
        "vuln-score-pills",
        (scored ? lastVuln.rows : rows)
          .map(function (pt) {
            const s = pt.susceptibility_score;
            const txt = s != null ? Number(s).toFixed(2) : "—";
            const tone = s == null ? "empty" : s === 0 ? "dry" : s >= 0.5 ? "hot" : "warm";
            return scorePill(pt.return_period + "y", txt, tone);
          })
          .join("") || '<p class="nf">Waiting on Hazard scores.</p>'
      );
      fillPills(
        "vuln-out-pills",
        rows
          .map(function (pt) {
            const d = pt.flood_depth_m != null ? pt.flood_depth_m.toFixed(2) + " m" : "—";
            const dr = pt.damage_ratio != null ? Math.round(pt.damage_ratio * 100) + "%" : "—";
            const tone = pt.damage_ratio != null && pt.damage_ratio >= 0.35 ? "hot" : pt.flood_depth_m === 0 ? "dry" : "warm";
            return scorePill(pt.return_period + "y", d, tone, dr);
          })
          .join("")
      );
      setText("vuln-in-note", "The five scores from Hazard, at this pin.");
      setText("vuln-out-note", "Metres from the score, then the class damage ratio.");
    }

    const classNote = document.getElementById("vuln-class-note");
    if (classNote) {
      const curve = VULN_CURVES[ctx.classKey] || VULN_CURVES.concrete_rcc;
      const label = ctx.classLabel || "class not found (RCC shape only)";
      classNote.textContent = label + ". K=" + curve.K + ", S0=" + curve.S0 + " m, k=" + curve.k + ".";
    }

    const cap = document.getElementById("vuln-caption");
    if (cap) {
      cap.textContent = lastVuln.rows.length
        ? "Crimson line is the JRC function. Dots are this pin after score → depth."
        : "Crimson line is the JRC function for the class. No site dots until scores exist.";
    }

    const tbody = document.querySelector("#vuln-table tbody");
    if (tbody) {
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="nf">not found</td></tr>';
      } else {
        tbody.innerHTML = rows
          .map(function (pt) {
            return (
              "<tr><td>" +
              stormLabel(pt) +
              " · " +
              pt.return_period +
              "y</td><td>" +
              (pt.susceptibility_score != null ? Number(pt.susceptibility_score).toFixed(2) : "—") +
              "</td><td>" +
              (pt.h_max_m != null ? pt.h_max_m.toFixed(2) + " m" : "—") +
              "</td><td>" +
              (pt.flood_depth_m != null ? pt.flood_depth_m.toFixed(2) + " m" : "—") +
              "</td><td>" +
              (pt.damage_ratio != null ? (pt.damage_ratio * 100).toFixed(1) + "%" : "—") +
              "</td></tr>"
            );
          })
          .join("");
      }
    }

    const chip = document.getElementById("wet-chip");
    if (chip) {
      if (ctx.floors != null && ctx.floors > 1) {
        chip.textContent =
          ctx.floors +
          " floors" +
          (ctx.basements ? " · " + ctx.basements + " basement" : "") +
          (ctx.plant ? " · critical plant" : "") +
          " — damage on the ground plate, not the tower TIV.";
      } else if (ctx.floors === 1) {
        chip.textContent = "Single storey — damage applies to full TIV.";
      } else {
        chip.textContent = "";
      }
    }

    renderStack(ctx);
  }

  function renderStack(ctx) {
    const host = document.getElementById("analysis-stack");
    if (!host) return;
    const floors = ctx.floors;
    const basements = ctx.basements || 0;
    if (floors == null) {
      host.innerHTML = '<p class="building-none">Floor count not found</p>';
      return;
    }

    const p100 = (lastVuln.rows || []).find(function (p) {
      return p.return_period === 100;
    });
    const depth = p100 && p100.flood_depth_m != null ? p100.flood_depth_m : null;
    const heightLabel = ctx.height != null ? ctx.height + " m" : "Height not found";
    const wetNote = depth != null ? "100y · " + depth.toFixed(2) + " m" : "Wet storey";

    let html = '<div class="building-wrap analysis-elev"><div class="building-elev">';
    html += '<div class="building-roof" title="Roof"></div>';
    if (floors >= 2) {
      html +=
        '<div class="building-floor building-upper"><span class="building-wall"></span><div class="building-plate"><span class="building-flabel">F2–' +
        floors +
        '</span><span class="building-note">Dry plate</span></div><span class="building-wall"></span></div>';
    }
    html +=
      '<div class="building-floor building-ground"><span class="building-wall"></span><div class="building-plate"><span class="building-flabel">G</span><span class="building-note">' +
      wetNote +
      '</span></div><span class="building-wall"></span></div>';
    html += '<div class="building-grade" title="Street / grade"></div>';
    if (basements) {
      html += '<div class="building-subgrade">';
      for (let b = 1; b <= Math.min(basements, 4); b++) {
        const plant = ctx.plant && b <= 2;
        html +=
          '<div class="building-floor building-' +
          (plant ? "plant" : "basement") +
          '"><span class="building-wall"></span><div class="building-plate"><span class="building-flabel">B' +
          b +
          "</span>" +
          (plant
            ? '<span class="building-note">Critical plant</span>'
            : '<span class="building-note">Below grade</span>') +
          '</div><span class="building-wall"></span></div>';
      }
      html += "</div>";
    }
    html +=
      '</div><div class="building-ruler" aria-label="Building height"><span class="building-ruler-top">' +
      escapeHtml(heightLabel) +
      '</span><span class="building-ruler-line"></span><span class="building-ruler-bot">0 m · grade</span>' +
      (basements ? '<span class="building-ruler-sub">B' + basements + "</span>" : "") +
      "</div></div>";
    host.innerHTML = html;
  }

  function renderExposure(ctx) {
    const rows = exposureRows(ctx);
    setText("exp-tiv", fmtKesFull(ctx.tiv));
    const bits = [];
    if (ctx.classLabel) bits.push(ctx.classLabel);
    if (ctx.floors != null) bits.push(ctx.floors + " floors");
    if (ctx.basements) bits.push(ctx.basements + " basement");
    if (ctx.plant) bits.push("critical plant");
    setText("exp-chip", bits.join(" · "));
    setText(
      "exp-in-note",
      ctx.tiv != null
        ? "TIV source: " + (ctx.tivSrc || "not found") + ". One facultative risk — not the 600-row synthetic book. Damage ratios from Vulnerability."
        : "TIV is not on the slip."
    );
    if (!rows.length) {
      fillPills("exp-dr-pills", '<p class="nf">Damage ratios arrive after Vulnerability.</p>');
      fillPills("exp-loss-pills", '<p class="nf">No ground-up until TIV and a damage ratio exist.</p>');
      setText("exp-out-note", "loss = TIV × damage ratio.");
    } else {
      fillPills(
        "exp-dr-pills",
        rows
          .map(function (pt) {
            const dr = pt.damage_ratio != null ? Math.round(pt.damage_ratio * 100) + "%" : "—";
            const tone = pt.damage_ratio == null ? "empty" : pt.damage_ratio >= 0.35 ? "hot" : "warm";
            return scorePill(pt.return_period + "y", dr, tone);
          })
          .join("")
      );
      fillPills(
        "exp-loss-pills",
        rows
          .map(function (pt) {
            return scorePill(
              pt.return_period + "y",
              fmtKes(pt.ground_up_loss_kes),
              pt.ground_up_loss_kes === 0 ? "dry" : "warm"
            );
          })
          .join("")
      );
      setText("exp-out-note", "loss = TIV × damage ratio.");
    }
    const tbody = document.querySelector("#exp-table tbody");
    if (tbody) {
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="nf">not found</td></tr>';
      } else {
        tbody.innerHTML = rows
          .map(function (pt) {
            return (
              "<tr><td>" +
              stormLabel(pt) +
              " · " +
              pt.return_period +
              "y</td><td>" +
              (pt.damage_ratio != null ? (pt.damage_ratio * 100).toFixed(1) + "%" : "—") +
              "</td><td>" +
              fmtKes(pt.ground_up_loss_kes) +
              "</td></tr>"
            );
          })
          .join("");
      }
    }
  }

  function renderFinance(ctx) {
    const rows = exposureRows(ctx);
    const guCount = rows.filter(function (r) {
      return r.ground_up_loss_kes != null;
    }).length;
    setText(
      "fin-in-aal",
      ctx.aalGu != null ? fmtKes(ctx.aalGu) + " ground-up AAL" : guCount ? guCount + " scenario losses" : "not found"
    );
    const dedPct =
      ctx.dedPct == null ? "deductible not found" : (ctx.dedPct <= 1 ? ctx.dedPct * 100 : ctx.dedPct).toFixed(1) + "%";
    const dedMin = ctx.dedMin == null ? "min not found" : fmtKes(ctx.dedMin) + " min";
    const lim = ctx.limit == null ? "limit not found" : fmtKes(ctx.limit);
    setText("fin-in-note", "Ground-up from Exposure. " + dedPct + " / " + dedMin + " · " + lim + ".");
    setText(
      "fin-out-note",
      ctx.hasModel
        ? "TIFF base only. Net of deductible and limit. AI comparison is on Results."
        : "Waiting on model output."
    );
    setText("fin-aal", fmtKes(ctx.aalNet));
    setText("fin-pml", fmtKes(ctx.pml100));
    const tvar = ctx.tvar100 || {};
    setText("fin-tvar", fmtKes(tvar.value));
    setText("fin-tvar-note", tvar.note || "");
    const host = document.getElementById("fin-terms");
    if (host) {
      const ded =
        ctx.dedPct == null && ctx.dedMin == null
          ? "not found"
          : (ctx.dedPct == null ? "" : (ctx.dedPct <= 1 ? ctx.dedPct * 100 : ctx.dedPct).toFixed(1) + "%") +
            (ctx.dedMin == null ? "" : (ctx.dedPct == null ? "" : " / ") + fmtKes(ctx.dedMin) + " min");
      const lim = ctx.limit == null ? "not found" : fmtKes(ctx.limit);
      const share = ctx.share == null ? "not found" : fmtPct(ctx.share <= 1 ? ctx.share * 100 : ctx.share, 1);
      host.innerHTML =
        "<div><dt>Deductible</dt><dd>" +
        escapeHtml(ded) +
        "</dd></div><div><dt>Policy limit</dt><dd>" +
        escapeHtml(lim) +
        "</dd></div><div><dt>Share</dt><dd>" +
        escapeHtml(share) +
        "</dd></div>";
    }
  }

  function sizeCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(240, Math.floor(rect.width));
    const h = Math.max(140, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function niceMax(n) {
    if (!n || n <= 0) return 1;
    const exp = Math.pow(10, Math.floor(Math.log10(n)));
    const m = n / exp;
    const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
    return nice * exp;
  }

  function drawEpCurve(canvas, curve, aiCurve) {
    const sized = sizeCanvas(canvas);
    const ctx = sized.ctx;
    const w = sized.w;
    const h = sized.h;
    ctx.clearRect(0, 0, w, h);
    if (!curve.length) return;

    const pad = { t: 18, r: 18, b: 44, l: 62 };
    const innerW = w - pad.l - pad.r;
    const innerH = h - pad.t - pad.b;
    const rps = curve.map(function (p) {
      return p.return_period;
    });
    const minRp = Math.min.apply(null, rps);
    const maxRp = Math.max.apply(null, rps);
    const series = curve.concat(Array.isArray(aiCurve) ? aiCurve : []);
    const maxLoss = niceMax(
      Math.max.apply(
        null,
        series.map(function (p) {
          return Math.max(p.ground_up_loss_kes || 0, p.net_loss_kes || 0);
        })
      )
    );

    function xOf(rp) {
      const t = (Math.log(rp) - Math.log(minRp)) / (Math.log(maxRp) - Math.log(minRp) || 1);
      return pad.l + t * innerW;
    }
    function yOf(loss) {
      return pad.t + innerH - (loss / maxLoss) * innerH;
    }

    ctx.strokeStyle = "#d7d0c6";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#6b645b";
    ctx.font = "11px IBM Plex Sans, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const v = (maxLoss * i) / 4;
      const y = yOf(v);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillText(fmtKes(v).replace("KES ", ""), pad.l - 8, y);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    curve.forEach(function (p) {
      const x = xOf(p.return_period);
      ctx.fillStyle = "#6b645b";
      ctx.fillText(p.return_period + "y", x, h - pad.b + 8);
      ctx.fillStyle = "#8a8478";
      ctx.fillText((p.aep * 100).toFixed(p.aep >= 0.01 ? 0 : 1) + "% AEP", x, h - pad.b + 22);
    });

    function strokeSeries(key, color, dash) {
      ctx.beginPath();
      ctx.setLineDash(dash || []);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      curve.forEach(function (p, i) {
        const x = xOf(p.return_period);
        const y = yOf(p[key] || 0);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    strokeSeries("ground_up_loss_kes", "#00274c", [5, 4]);
    strokeSeries("net_loss_kes", "#d11242");
    if (aiCurve && aiCurve.length) {
      ctx.beginPath();
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = "#7c5cbf";
      ctx.lineWidth = 2.2;
      aiCurve.forEach(function (p, i) {
        const x = xOf(p.return_period);
        const y = yOf(p.net_loss_kes || 0);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      aiCurve.forEach(function (p) {
        const x = xOf(p.return_period);
        const y = yOf(p.net_loss_kes || 0);
        ctx.fillStyle = "#7c5cbf";
        ctx.beginPath();
        ctx.arc(x, y, 3.4, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    curve.forEach(function (p) {
      const x = xOf(p.return_period);
      const yNet = yOf(p.net_loss_kes || 0);
      const yGu = yOf(p.ground_up_loss_kes || 0);
      ctx.fillStyle = "#00274c";
      ctx.beginPath();
      ctx.arc(x, yGu, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#d11242";
      ctx.beginPath();
      ctx.arc(x, yNet, 4, 0, Math.PI * 2);
      ctx.fill();
      if (p.return_period === 100 || p.return_period === 250) {
        ctx.strokeStyle = "#c4a35a";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(x, yNet, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  function jrcRaw(depth, classKey) {
    const curve = VULN_CURVES[classKey] || VULN_CURVES.concrete_rcc;
    const dr = curve.K / (1 + Math.exp(-curve.k * (depth - curve.S0)));
    return Math.min(Math.max(dr, 0), curve.K);
  }

  function drawDepthDamage(canvas) {
    const sized = sizeCanvas(canvas);
    const ctx = sized.ctx;
    const w = sized.w;
    const h = sized.h;
    ctx.clearRect(0, 0, w, h);

    const classKey = lastVuln.classKey;
    const rows = lastVuln.rows || [];
    const params = VULN_CURVES[classKey] || VULN_CURVES.concrete_rcc;
    const pad = { t: 18, r: 14, b: 32, l: 40 };
    const innerW = w - pad.l - pad.r;
    const innerH = h - pad.t - pad.b;
    const maxD = 2.4;
    const maxDr = Math.max(0.7, params.K * 1.08);

    function xOf(d) {
      return pad.l + (d / maxD) * innerW;
    }
    function yOf(dr) {
      return pad.t + innerH - (dr / maxDr) * innerH;
    }

    ctx.strokeStyle = "#ead6dc";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#6b645b";
    ctx.font = "10px IBM Plex Sans, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const v = (maxDr * i) / 4;
      const y = yOf(v);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillText(Math.round(v * 100) + "%", pad.l - 6, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("Derived flood depth (m)", pad.l + innerW / 2, h - 14);
    ctx.fillText("0", pad.l, h - pad.b + 6);
    ctx.fillText(maxD.toFixed(1), w - pad.r, h - pad.b + 6);

    const s0x = xOf(params.S0);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "#c4a35a";
    ctx.beginPath();
    ctx.moveTo(s0x, pad.t);
    ctx.lineTo(s0x, pad.t + innerH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#8a7340";
    ctx.textBaseline = "bottom";
    ctx.fillText("S0 " + params.S0.toFixed(1) + " m", s0x, pad.t + innerH - 4);

    ctx.beginPath();
    ctx.strokeStyle = "#d11242";
    ctx.lineWidth = 1.8;
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const d = (i / steps) * maxD;
      const x = xOf(d);
      const y = yOf(jrcRaw(d, classKey));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    rows.forEach(function (p) {
      if (p.flood_depth_m == null || p.damage_ratio == null) return;
      const x = xOf(p.flood_depth_m);
      const y = yOf(p.damage_ratio);
      ctx.fillStyle = "#d11242";
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#00274c";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(p.return_period + "y", x + 6, y - 3);
    });
  }

  function buildContext(run) {
    const exp = run.exposure || {};
    const res = run.results || {};
    const metrics = res.metrics || {};
    const curve = normalizeCurve(res.ep_curve || res.epCurve || res.scenarios);

    const name = unwrap(exp.property_name);
    const ref = unwrap(exp.reference);
    const lat = pick(exp, "coordinates.lat");
    const lon = pick(exp, "coordinates.lon");
    const elev = pick(exp, "coordinates.elevation_m");
    const outCoords = res.property && res.property.coordinates ? res.property.coordinates : null;
    if (outCoords && outCoords.lat != null) lat.value = outCoords.lat;
    if (outCoords && outCoords.lon != null) lon.value = outCoords.lon;
    const klass = pick(exp, "exposure.housing_class");
    const floors = pick(exp, "exposure.floors_above_ground");
    const basements = pick(exp, "exposure.basement_floors");
    const height = pick(exp, "exposure.total_height_m");
    const plant = pick(exp, "exposure.critical_plant_in_basement");
    const tiv = pick(exp, "exposure.tiv_kes");
    const gfa = pick(exp, "exposure.floor_area_m2");
    const occ = pick(exp, "exposure.occupancy");
    const coverSub = pick(exp, "coverage.cover_subject");
    const coverType = pick(exp, "coverage.coverage_type");
    const dedPct = pick(exp, "financial_terms.deductible_pct");
    const dedMin = pick(exp, "financial_terms.deductible_min_kes");
    const limit = pick(exp, "financial_terms.policy_limit_kes");
    const share = findShare(exp);
    const address =
      (exp.audit && exp.audit.extracted_address) ||
      unwrap(exp.address).value ||
      (exp.audit && exp.audit.geocode_suggestion && exp.audit.geocode_suggestion.label) ||
      null;

    const ai = res.ai_upgrade || {};
    const aiMetrics = res.ai_metrics || {};
    const aiCurve = normalizeCurve(res.ai_ep_curve || res.aiEpCurve);
    const aalNet = num(metrics.aal_net_kes);
    const aalGu = num(metrics.aal_ground_up_kes);
    const pml100 = num(metrics.pml_100y_kes);
    const pml250 = num(metrics.pml_250y_kes);
    const aiAalNet = num(aiMetrics.aal_net_kes);
    const aiPml100 = num(aiMetrics.pml_100y_kes);
    const tivN = num(tiv.value);
    const limitN = num(limit.value);
    const rol = num(metrics.rate_on_line_pct);

    return {
      property: name.value || null,
      reference: ref.value || exp.id || null,
      peril: unwrap(exp.peril).value || "Nairobi urban pluvial",
      address: address,
      lat: num(lat.value),
      lon: num(lon.value),
      gps: gpsKind(exp),
      elev: num(elev.value),
      elevSrc: elev.source,
      classKey: klass.value,
      classLabel: klass.value ? CLASS_LABELS[klass.value] || String(klass.value) : null,
      classSrc: klass.source,
      floors: num(floors.value),
      basements: num(basements.value),
      height: num(height.value),
      plant: isBlank(plant.value) ? null : Boolean(plant.value),
      gfa: num(gfa.value),
      gfaSrc: gfa.source,
      occupancy: occ.value || null,
      coverSubject: coverSub.value || null,
      coverType: coverType.value || null,
      coverSrc: coverSub.source || coverType.source,
      tiv: tivN,
      tivSrc: tiv.source,
      dedPct: num(dedPct.value),
      dedSrc: dedPct.source,
      dedMin: num(dedMin.value),
      dedMinSrc: dedMin.source,
      limit: limitN,
      limitSrc: limit.source,
      share: num(share.value),
      shareSrc: share.source,
      aalNet: aalNet,
      aalGu: aalGu,
      pml100: pml100,
      pml250: pml250,
      aiApplied: Boolean(ai.applied),
      aiReason: ai.reason || null,
      aiHotspot: (ai.nearest_blinded && ai.nearest_blinded.name) || null,
      aiDistanceKm: ai.nearest_blinded && ai.nearest_blinded.distance_km,
      aiBriefing: ai.briefing || null,
      aiSources: Array.isArray(ai.sources) ? ai.sources : [],
      aiAssumptions: Array.isArray(ai.assumptions) ? ai.assumptions : [],
      aiAalNet: aiAalNet,
      aiPml100: aiPml100,
      aiCurve: aiCurve,
      rol: rol,
      tvar100: constructedTvar(curve, 0.02),
      pml250Ratio: tivN && pml250 != null ? pml250 / tivN : null,
      hotspot: Boolean(res.hazard_summary && res.hazard_summary.nearby_hotspot),
      hotspotName: res.hazard_summary && res.hazard_summary.nearby_hotspot,
      scoreSource: res.hazard_summary && res.hazard_summary.score_source,
      scoreKm: res.hazard_summary && res.hazard_summary.score_distance_km,
      curve: curve,
      hasModel: Boolean(res.metrics || curve.length),
      isSample: Boolean(run.raw && run.raw.sample),
      sessionId: (run.raw && run.raw.id) || (window.KenyaReSession && window.KenyaReSession.get()) || null
    };
  }

  let lastCurve = [];
  let lastAiCurve = [];
  let lastVuln = { classKey: null, rows: [] };
  let lastCtx = null;

  const STEPS = [
    { id: "hazard", title: "Hazard", nextLabel: "Next · Vulnerability" },
    { id: "vulnerability", title: "Vulnerability", nextLabel: "Next · Exposure" },
    { id: "exposure", title: "Exposure", nextLabel: "Next · Finance" },
    { id: "finance", title: "Finance", nextLabel: "Next · Results" },
    { id: "results", title: "Results", nextLabel: "Back to review" }
  ];

  function stepFromHash() {
    const raw = (location.hash || "").replace(/^#/, "").toLowerCase();
    if (raw === "financial") return "finance";
    if (raw === "result") return "results";
    return STEPS.some(function (s) { return s.id === raw; }) ? raw : "hazard";
  }

  function showStep(id) {
    const idx = STEPS.findIndex(function (s) { return s.id === id; });
    const step = STEPS[idx] || STEPS[0];
    document.querySelectorAll("[data-step]").forEach(function (el) {
      el.classList.toggle("hidden", el.getAttribute("data-step") !== step.id);
    });
    document.querySelectorAll(".cat-pipeline [data-nav]").forEach(function (el) {
      el.classList.toggle("is-active", el.getAttribute("data-nav") === step.id);
    });
    const title = document.getElementById("analysis-title");
    if (title) title.textContent = "Analysis";
    const prev = document.getElementById("step-prev");
    const next = document.getElementById("step-next");
    const backToReview = reviewHref();
    if (prev) {
      if (idx <= 0) {
        prev.textContent = "Review";
        prev.setAttribute("href", backToReview);
      } else {
        prev.textContent = "Previous";
        prev.setAttribute("href", "#" + STEPS[idx - 1].id);
      }
    }
    if (next) {
      if (idx >= STEPS.length - 1) {
        next.textContent = "Review";
        next.setAttribute("href", backToReview);
      } else {
        next.textContent = "Next";
        next.setAttribute("href", "#" + STEPS[idx + 1].id);
      }
    }
    if (lastCtx) renderStormRail(lastCtx, step.id);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        drawAll(lastCurve);
      });
    });
  }

  function stepIsVisible(canvas) {
    if (!canvas) return false;
    const host = canvas.closest("[data-step]");
    return !host || !host.classList.contains("hidden");
  }

  function drawAll(curve, aiCurve) {
    if (curve) lastCurve = curve;
    if (aiCurve) lastAiCurve = aiCurve;
    const ep = document.getElementById("ep-chart");
    const dd = document.getElementById("dd-chart");
    const fold = document.getElementById("dd-fold");
    if (ep && stepIsVisible(ep)) drawEpCurve(ep, lastCurve, null);
    const resEp = document.getElementById("res-ep-chart");
    if (resEp && stepIsVisible(resEp)) drawEpCurve(resEp, lastCurve, lastAiCurve);
    if (dd && stepIsVisible(dd) && (!fold || fold.open)) drawDepthDamage(dd);
  }

  function bindFolds() {
    const fold = document.getElementById("dd-fold");
    if (fold && !fold.dataset.bound) {
      fold.dataset.bound = "1";
      fold.addEventListener("toggle", function () {
        if (fold.open) drawAll(lastCurve);
      });
    }
  }

  async function render() {
    const empty = document.getElementById("analysis-empty");
    const page = document.getElementById("analysis-page");
    const q = new URLSearchParams(location.search);
    const sid = (window.KenyaReSession && window.KenyaReSession.get()) || q.get("id");
    const waiting = q.get("fresh") === "1" || Boolean(window.KenyaReSession && window.KenyaReSession.getPending());

    if (waiting) {
      if (empty) empty.classList.add("hidden");
      if (page) page.classList.add("hidden");
    }

    let run = await loadRun();
    if (!runHasOutput(run) && waiting && sid) {
      run = await waitForRun(sid, {
        property: (run && run.exposure && (unwrap(run.exposure.property_name).value || run.exposure.property_name)) || null
      });
    }
    if (window.KenyaReSession) {
      window.KenyaReSession.hideAgg();
      if (runHasOutput(run)) {
        window.KenyaReSession.clearPending();
        window.KenyaReSession.clearFreshRun();
      }
    }

    if (!runHasOutput(run)) {
      if (empty) empty.classList.remove("hidden");
      if (page) page.classList.add("hidden");
      if (sid) {
        const heading = empty && empty.querySelector("p.text-sm.font-medium");
        if (heading) heading.textContent = "Session " + sid + " has no stored run yet";
        empty.querySelectorAll('a[href="review.html"]').forEach(function (a) {
          a.setAttribute("href", reviewHref(sid));
        });
      }
      return;
    }
    if (empty) empty.classList.add("hidden");
    if (page) page.classList.remove("hidden");

    const ctx = buildContext(run);
    lastCtx = ctx;
    bindFolds();
    const banner = document.getElementById("sample-banner");
    if (banner) banner.classList.toggle("hidden", !ctx.isSample);
    const decision = decide(ctx);
    renderDecision(ctx, decision);
    renderHazard(ctx);
    renderVulnerability(ctx);
    renderExposure(ctx);
    renderFinance(ctx);
    renderResults(ctx);
    bindResultsDesk();
    lastCurve = ctx.curve || [];
    lastAiCurve = ctx.aiCurve || [];
    if (!location.hash || location.hash === "#") {
      history.replaceState(null, "", location.pathname + location.search + "#hazard");
    }
    showStep(stepFromHash());
  }

  window.addEventListener("hashchange", function () {
    showStep(stepFromHash());
  });

  window.addEventListener("resize", function () {
    drawAll(lastCurve);
  });

  render();
})();
