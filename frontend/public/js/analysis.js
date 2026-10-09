/**
 * Analysis frontend — four-module CAT desk (hazard → vulnerability → exposure → finance).
 * Hazard shows TIFF scores only. Vulnerability translates those scores locally:
 *   depth = H_max(RP) × score, then JRC Huizinga DR for the construction class.
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

  const H_MAX_M = { 10: 0.5, 25: 0.8, 50: 1.2, 100: 1.8, 250: 2.2 };

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
      return p.susceptibility_score != null;
    });
  }

  function vulnDerived(ctx) {
    return realScorePoints(ctx).map(function (p) {
      const score = p.susceptibility_score;
      const hmax = p.h_max_m != null ? p.h_max_m : hMaxFor(p.return_period);
      const depth =
        score == null || hmax == null ? null : score <= 0 ? 0 : Math.round(hmax * score * 100) / 100;
      return {
        return_period: p.return_period,
        susceptibility_score: score,
        h_max_m: hmax,
        flood_depth_m: depth,
        damage_ratio: damageRatioAt(depth, ctx.classKey)
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
    const rp = firstNum(p, ["return_period", "rp", "returnPeriod"]);
    if (rp == null) return null;
    return {
      tier: p.tier || null,
      return_period: rp,
      aep: firstNum(p, ["aep", "exceedance_prob", "exceedanceProbability"]),
      susceptibility_score: firstNum(p, [
        "susceptibility_score",
        "susceptibility",
        "hazard_score",
        "tiff_score",
        "score"
      ]),
      h_max_m: firstNum(p, ["h_max_m", "h_max", "hMax", "assumed_max_depth_m", "max_depth_m"]),
      flood_depth_m: firstNum(p, ["flood_depth_m", "depth_m", "local_depth_m", "depth"]),
      damage_ratio: firstNum(p, ["damage_ratio", "dr", "damageRatio"]),
      ground_up_loss_kes: firstNum(p, [
        "ground_up_loss_kes",
        "ground_up",
        "groundUpLoss"
      ]),
      deductible_kes: firstNum(p, ["deductible_kes", "deductible"]),
      net_loss_kes: firstNum(p, ["net_loss_kes", "net", "gross_loss_kes", "netLoss"])
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
          { return_period: 10, aep: 0.1, damage_ratio: 0.08, ground_up_loss_kes: 4000000, net_loss_kes: 2000000 },
          { return_period: 25, aep: 0.04, damage_ratio: 0.14, ground_up_loss_kes: 11000000, net_loss_kes: 8000000 },
          { return_period: 50, aep: 0.02, damage_ratio: 0.22, ground_up_loss_kes: 21000000, net_loss_kes: 18000000 },
          { return_period: 100, aep: 0.01, damage_ratio: 0.38, ground_up_loss_kes: 32000000, net_loss_kes: 28000000 },
          { return_period: 250, aep: 0.004, damage_ratio: 0.48, ground_up_loss_kes: 42000000, net_loss_kes: 38000000 }
        ]
      }
    };
  }

  async function loadRun() {
    const q = new URLSearchParams(location.search);
    if (q.get("sample") === "1" || q.get("sample") === "true") {
      return parseRun(sampleRun());
    }

    const id = (window.KenyaReSession && window.KenyaReSession.get()) || q.get("id");
    if (!id) return null;

    try {
      const ctrl = typeof AbortController === "function" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
      const res = await fetch(API_BASE + "/api/session/" + encodeURIComponent(id), ctrl ? { signal: ctrl.signal } : {});
      if (timer) clearTimeout(timer);
      if (!res.ok) return null;
      const session = await res.json();
      if (window.KenyaReSession) window.KenyaReSession.set(session.id || id);
      const input = session.input || {};
      const output = session.output || {};
      const results = output.results || output;
      window.__kenyaReSessionPair = { id: session.id || id, input: input, output: output };
      return {
        exposure: input,
        results: results,
        raw: { id: session.id || id, input: input, output: output }
      };
    } catch (e) {
      console.warn("Analysis: session load failed", e);
      return null;
    }
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

    if (ctx.hotspotName) conditions.push("Named drainage corridor — score already encodes terrain");
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
    setText("dec-aal", fmtKes(ctx.aalNet));
    setText("dec-pml", fmtKes(ctx.pml100));
    setText("decision-why", decision.why);
    setText("risk-name", ctx.property || "Unnamed risk");
    setText("risk-ref", ctx.reference || "");
  }

  function stormLabel(pt) {
    const names = {
      10: "Frequent",
      25: "Severe",
      50: "Moderate",
      100: "Occasional",
      250: "Rare / El Niño"
    };
    return names[pt.return_period] || pt.tier || "Storm";
  }

  function renderHazard(ctx) {
    const gpsTxt =
      ctx.lat != null && ctx.lon != null
        ? ctx.lat.toFixed(4) + ", " + ctx.lon.toFixed(4)
        : "not found";
    setText("haz-gps", gpsTxt);
    setText("haz-address", ctx.address || "Address not found");
    setText("haz-gps-kind", ctx.gps && ctx.gps.label ? ctx.gps.label : "");

    const pills = document.getElementById("haz-score-pills");
    const fakeSource = ctx.scoreSource === "sample" || ctx.isSample;
    const scored = fakeSource
      ? []
      : ctx.curve.filter(function (pt) {
          return pt.susceptibility_score != null;
        });
    const chartFrame = document.getElementById("hz-chart-wrap");
    const chartEmpty = document.getElementById("hz-chart-empty");
    if (chartFrame) chartFrame.classList.toggle("hidden", !scored.length);
    if (chartEmpty) chartEmpty.classList.toggle("hidden", Boolean(scored.length));
    if (pills) {
      if (!scored.length) {
        pills.innerHTML = '<p class="nf">Not found — waiting on backend TIFF scores for this pin.</p>';
      } else {
        pills.innerHTML = ctx.curve
          .map(function (pt) {
            const s = pt.susceptibility_score;
            const txt = s != null ? Number(s).toFixed(2) : "—";
            const tone = s == null ? "empty" : s === 0 ? "dry" : s >= 0.5 ? "hot" : "warm";
            return (
              '<div class="score-pill score-pill-' +
              tone +
              '"><em>' +
              pt.return_period +
              "y</em><strong>" +
              txt +
              "</strong></div>"
            );
          })
          .join("");
      }
    }
    const km = ctx.scoreKm != null ? "Sampled " + ctx.scoreKm.toFixed(2) + " km from the pin. " : "";
    setText(
      "haz-drain-note",
      scored.length
        ? km + "TIFF cell value (0–1) from the backend. Not invented on this page."
        : "No real TIFF scores on this run. Backend will attach them — this page will not invent them."
    );

    const tbody = document.querySelector("#hz-table tbody");
    if (tbody) {
      if (!ctx.curve.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="nf">not found</td></tr>';
      } else {
        tbody.innerHTML = ctx.curve
          .map(function (pt) {
            const score =
              pt.susceptibility_score != null
                ? Number(pt.susceptibility_score).toFixed(2)
                : "not found";
            return (
              "<tr><td>" +
              stormLabel(pt) +
              "</td><td>" +
              pt.return_period +
              "y</td><td>" +
              score +
              "</td></tr>"
            );
          })
          .join("");
      }
    }
  }

  function renderVulnerability(ctx) {
    lastVuln = { classKey: ctx.classKey, rows: vulnDerived(ctx) };
    const rows = lastVuln.rows;
    const inPills = document.getElementById("vuln-score-pills");
    const outPills = document.getElementById("vuln-out-pills");

    if (inPills) {
      if (!rows.length) {
        inPills.innerHTML = '<p class="nf">Not found — Hazard has not sent real TIFF scores yet.</p>';
      } else {
        inPills.innerHTML = rows
          .map(function (pt) {
            const s = pt.susceptibility_score;
            const tone = s == null ? "empty" : s === 0 ? "dry" : s >= 0.5 ? "hot" : "warm";
            return (
              '<div class="score-pill score-pill-' +
              tone +
              '"><em>' +
              pt.return_period +
              "y</em><strong>" +
              Number(s).toFixed(2) +
              "</strong></div>"
            );
          })
          .join("");
      }
    }
    setText(
      "vuln-in-note",
      rows.length
        ? "Same five scores as Hazard. This step does not look up the TIFF again."
        : "Waiting on backend TIFF scores. This page will not invent them."
    );

    if (outPills) {
      if (!rows.length) {
        outPills.innerHTML = '<p class="nf">No depths or damage ratios until scores arrive.</p>';
      } else {
        outPills.innerHTML = rows
          .map(function (pt) {
            const d = pt.flood_depth_m != null ? pt.flood_depth_m.toFixed(2) + " m" : "—";
            const dr = pt.damage_ratio != null ? Math.round(pt.damage_ratio * 100) + "%" : "—";
            const tone = pt.damage_ratio != null && pt.damage_ratio >= 0.35 ? "hot" : "warm";
            return (
              '<div class="score-pill score-pill-' +
              tone +
              '"><em>' +
              pt.return_period +
              "y</em><strong>" +
              d +
              "</strong><span class='score-sub'>" +
              dr +
              "</span></div>"
            );
          })
          .join("");
      }
    }
    setText(
      "vuln-out-note",
      rows.length
        ? "depth = Hmax × score, then JRC damage ratio for this class."
        : "Outputs stay empty until Hazard has real scores."
    );

    const classNote = document.getElementById("vuln-class-note");
    if (classNote) {
      const curve = VULN_CURVES[ctx.classKey] || VULN_CURVES.concrete_rcc;
      const label = ctx.classLabel || "class not found (RCC used as the function shape only)";
      classNote.textContent =
        "This risk: " +
        label +
        ". Ceiling K=" +
        curve.K +
        ", midpoint S0=" +
        curve.S0 +
        " m, steepness k=" +
        curve.k +
        ".";
    }

    const cap = document.getElementById("vuln-caption");
    if (cap) {
      cap.textContent = rows.length
        ? "Crimson line is the JRC function. Dots are this pin after score → depth."
        : "Crimson line is the JRC function for the class. No site dots until TIFF scores exist.";
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
              pt.return_period +
              "y</td><td>" +
              Number(pt.susceptibility_score).toFixed(2) +
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
            ? '<span class="badge" style="background:var(--brand-soft);color:var(--brand)">Critical plant</span>'
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

    const cap = document.getElementById("stack-caption");
    if (cap) {
      const plate =
        ctx.floors > 1
          ? "Wet-storey split: the model should damage the ground plate" +
            (ctx.plant ? " and basement plant" : "") +
            " — not the full tower TIV."
          : "Single storey: damage applies to full TIV.";
      cap.textContent = plate + " Upper floors stay dry.";
    }
  }

  function renderExposure(ctx) {
    const gpsTxt =
      ctx.lat != null && ctx.lon != null
        ? ctx.lat.toFixed(4) + ", " + ctx.lon.toFixed(4)
        : "not found";
    setText("exp-gps", gpsTxt);
    setText("exp-address", ctx.address || "Address not found");
    const status = document.getElementById("exp-gps-status");
    if (status) {
      status.textContent = ctx.gps.label;
      status.setAttribute("data-kind", ctx.gps.kind);
    }
    setHtml("exp-gps-source", badge(ctx.gps.source));

    setText("exp-tiv", fmtKesFull(ctx.tiv));
    setHtml("exp-tiv-src", badge(ctx.tivSrc));
    setText("exp-class", ctx.classLabel || "not found");
    setHtml("exp-class-src", badge(ctx.classSrc));
    setText("exp-gfa", ctx.gfa != null ? ctx.gfa.toLocaleString("en-KE") + " m²" : "not found");
    setHtml("exp-gfa-src", badge(ctx.gfaSrc));

    if (ctx.floors == null && ctx.basements == null) {
      setText("exp-floors", "not found");
    } else {
      const fl = ctx.floors == null ? "floors not found" : ctx.floors + " above grade";
      const bs = ctx.basements == null ? "basements not found" : ctx.basements + " basement";
      setText("exp-floors", fl + " · " + bs);
    }
    setText(
      "exp-plant",
      ctx.plant == null ? "" : ctx.plant ? "Critical plant in basement" : "No basement plant flagged"
    );

    const coverBits = [];
    if (ctx.coverSubject) coverBits.push(ctx.coverSubject);
    if (ctx.coverType) coverBits.push(ctx.coverType);
    setText("exp-cover", coverBits.length ? coverBits.join(" · ") : "not found");
    setHtml("exp-cover-src", badge(ctx.coverSrc));
    setText("exp-occ", ctx.occupancy || "not found");

    renderMap(ctx);
  }

  let analysisMap = null;
  let analysisMarker = null;

  function renderMap(ctx) {
    const el = document.getElementById("exposure-map");
    if (!el) return;
    if (ctx.lat == null || ctx.lon == null) {
      if (analysisMap) {
        analysisMap.remove();
        analysisMap = null;
        analysisMarker = null;
      }
      el.innerHTML = '<p class="map-empty">GPS not found — pin on Review</p>';
      return;
    }
    if (typeof L === "undefined") {
      el.innerHTML = '<p class="map-empty">' + ctx.lat.toFixed(4) + ", " + ctx.lon.toFixed(4) + "</p>";
      return;
    }
    if (!analysisMap) {
      el.innerHTML = "";
      analysisMap = L.map(el, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false
      }).setView([ctx.lat, ctx.lon], 14);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(analysisMap);
      analysisMarker = L.circleMarker([ctx.lat, ctx.lon], {
        radius: 8,
        color: "#d11242",
        fillColor: "#d11242",
        fillOpacity: 0.9,
        weight: 2
      }).addTo(analysisMap);
    } else {
      analysisMap.setView([ctx.lat, ctx.lon], 14);
      analysisMarker.setLatLng([ctx.lat, ctx.lon]);
    }
    setTimeout(function () {
      if (analysisMap) analysisMap.invalidateSize();
    }, 60);
  }

  function ledgerRow(label, valueHtml, note) {
    return (
      '<div class="ledger-row">' +
      "<div><dt>" +
      label +
      "</dt>" +
      (note ? '<p class="ledger-note">' + note + "</p>" : "") +
      "</div><dd>" +
      valueHtml +
      "</dd></div>"
    );
  }

  function renderFinance(ctx) {
    setText("fin-premium", fmtKes(ctx.aalNet));
    setText(
      "fin-premium-note",
      ctx.aalNet != null
        ? "Trapezoidal integral of the net EP points. Expense and profit load are not applied."
        : "Run the model to price a pure premium."
    );

    const rolNote =
      ctx.tiv != null && ctx.aalNet != null
        ? "Net AAL ÷ TIV (model). ROL on limit " +
          (ctx.limit != null && ctx.limit > 0 ? fmtPct((ctx.aalNet / ctx.limit) * 100) : "not found")
        : "";

    const dedTxt = (function () {
      if (ctx.dedPct == null && ctx.dedMin == null) return nf("not found");
      const pct = ctx.dedPct == null ? "not found" : (ctx.dedPct <= 1 ? ctx.dedPct * 100 : ctx.dedPct).toFixed(1) + "%";
      const min = ctx.dedMin == null ? "min not found" : fmtKes(ctx.dedMin) + " min";
      return escapeHtml(pct + " / " + min);
    })();

    const shareHtml =
      ctx.share == null ? nf("not found") : escapeHtml(fmtPct(ctx.share <= 1 ? ctx.share * 100 : ctx.share, 1));

    const tvarHtml = ctx.tvar100 && ctx.tvar100.value != null ? escapeHtml(fmtKes(ctx.tvar100.value)) : nf("not found");

    const host = document.getElementById("finance-ledger");
    if (host) {
      host.innerHTML = [
        ledgerRow("Rate on line", ctx.rol == null ? nf("not found") : escapeHtml(fmtPct(ctx.rol)), rolNote),
        ledgerRow("AAL · ground-up", ctx.aalGu == null ? nf("not found") : escapeHtml(fmtKes(ctx.aalGu)), "Before deductible"),
        ledgerRow("AAL · net", ctx.aalNet == null ? nf("not found") : escapeHtml(fmtKes(ctx.aalNet)), "After deductible & limit"),
        ledgerRow("PML @ 100-year", ctx.pml100 == null ? nf("not found") : escapeHtml(fmtKes(ctx.pml100)), "1% AEP · net"),
        ledgerRow("PML @ 250-year", ctx.pml250 == null ? nf("not found") : escapeHtml(fmtKes(ctx.pml250)), "0.4% AEP · net"),
        ledgerRow("TVaR @ 100-year", tvarHtml, ctx.tvar100 ? ctx.tvar100.note : "not found"),
        ledgerRow(
          "Deductible",
          dedTxt,
          (ctx.dedSrc ? badge(ctx.dedSrc) : "") +
            (ctx.dedMinSrc && ctx.dedMinSrc !== ctx.dedSrc ? " " + badge(ctx.dedMinSrc) : "")
        ),
        ledgerRow("Policy limit", ctx.limit == null ? nf("not found") : escapeHtml(fmtKes(ctx.limit)), badge(ctx.limitSrc)),
        ledgerRow("Share", shareHtml, "Quota share is optional on this facultative slip")
      ].join("");
    }

    const ratio = ctx.limit != null && ctx.limit > 0 && ctx.pml250 != null ? ctx.pml250 / ctx.limit : null;
    const bar = document.getElementById("limit-consume-bar");
    const pctEl = document.getElementById("limit-consume-pct");
    const note = document.getElementById("limit-consume-note");
    if (pctEl) pctEl.textContent = ratio == null ? "not found" : (ratio * 100).toFixed(1) + "%";
    if (bar) bar.style.width = ratio == null ? "0%" : Math.min(100, Math.max(2, ratio * 100)) + "%";
    if (note) {
      note.textContent =
        ratio == null
          ? "Need both 250-year net loss and a policy limit."
          : fmtKes(ctx.pml250) + " of " + fmtKes(ctx.limit) + " limit at the 250-year point.";
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

  function drawHazardDepths(canvas, curve) {
    const sized = sizeCanvas(canvas);
    const ctx = sized.ctx;
    const w = sized.w;
    const h = sized.h;
    ctx.clearRect(0, 0, w, h);
    const scored = (curve || []).filter(function (p) {
      return p.susceptibility_score != null;
    });
    if (!scored.length) return;

    const pad = { t: 16, r: 10, b: 28, l: 36 };
    const innerW = w - pad.l - pad.r;
    const innerH = h - pad.t - pad.b;
    const maxD = 1;
    const gap = 8;
    const barW = Math.max(10, (innerW - gap * (scored.length - 1)) / scored.length);

    ctx.strokeStyle = "#c8d4e0";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#5c6b7a";
    ctx.font = "10px IBM Plex Sans, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 2; i++) {
      const v = (maxD * i) / 2;
      const y = pad.t + innerH - (v / maxD) * innerH;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillText(v.toFixed(1), pad.l - 6, y);
    }

    scored.forEach(function (p, i) {
      const d = p.susceptibility_score;
      const bh = (d / maxD) * innerH;
      const x = pad.l + i * (barW + gap);
      const y = pad.t + innerH - bh;
      ctx.fillStyle = i === scored.length - 1 ? "#d11242" : "#00274c";
      ctx.fillRect(x, y, barW, Math.max(2, bh));
      ctx.fillStyle = "#5c6b7a";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(p.return_period + "y", x + barW / 2, h - pad.b + 6);
    });
  }

  function drawEpCurve(canvas, curve) {
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
    const maxLoss = niceMax(
      Math.max.apply(
        null,
        curve.map(function (p) {
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

    const aalNet = num(metrics.aal_net_kes);
    const aalGu = num(metrics.aal_ground_up_kes);
    const pml100 = num(metrics.pml_100y_kes);
    const pml250 = num(metrics.pml_250y_kes);
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
      rol: rol,
      tvar100: constructedTvar(curve, 0.01),
      pml250Ratio: tivN && pml250 != null ? pml250 / tivN : null,
      hotspot: Boolean(res.hazard_summary && res.hazard_summary.nearby_hotspot),
      hotspotName: res.hazard_summary && res.hazard_summary.nearby_hotspot,
      scoreSource: res.hazard_summary && res.hazard_summary.score_source,
      scoreKm: res.hazard_summary && res.hazard_summary.score_distance_km,
      curve: curve,
      hasModel: Boolean(res.metrics || curve.length),
      isSample: Boolean(run.raw && run.raw.sample)
    };
  }

  let lastCurve = [];
  let lastVuln = { classKey: null, rows: [] };

  const STEPS = [
    { id: "hazard", title: "Hazard", nextLabel: "Next · Vulnerability" },
    { id: "vulnerability", title: "Vulnerability", nextLabel: "Next · Exposure" },
    { id: "exposure", title: "Exposure", nextLabel: "Next · Finance" },
    { id: "finance", title: "Finance engine", nextLabel: "Back to review" }
  ];

  function stepFromHash() {
    const raw = (location.hash || "").replace(/^#/, "").toLowerCase();
    if (raw === "financial") return "finance";
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
    if (prev) {
      if (idx <= 0) {
        prev.textContent = "Review";
        prev.setAttribute("href", "review.html");
      } else {
        prev.textContent = "Previous";
        prev.setAttribute("href", "#" + STEPS[idx - 1].id);
      }
    }
    if (next) {
      if (idx >= STEPS.length - 1) {
        next.textContent = "Review";
        next.setAttribute("href", "review.html");
      } else {
        next.textContent = "Next";
        next.setAttribute("href", "#" + STEPS[idx + 1].id);
      }
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        drawAll(lastCurve);
        if (step.id === "exposure" && analysisMap) analysisMap.invalidateSize();
      });
    });
  }

  function stepIsVisible(canvas) {
    if (!canvas) return false;
    const host = canvas.closest("[data-step]");
    return !host || !host.classList.contains("hidden");
  }

  function drawAll(curve) {
    if (curve) lastCurve = curve;
    const hz = document.getElementById("hz-chart");
    const ep = document.getElementById("ep-chart");
    const dd = document.getElementById("dd-chart");
    if (hz && stepIsVisible(hz)) drawHazardDepths(hz, lastCurve);
    if (ep && stepIsVisible(ep)) drawEpCurve(ep, lastCurve);
    if (dd && stepIsVisible(dd)) drawDepthDamage(dd);
  }

  async function render() {
    const run = await loadRun();
    const empty = document.getElementById("analysis-empty");
    const page = document.getElementById("analysis-page");
    if (!run) {
      if (empty) empty.classList.remove("hidden");
      if (page) page.classList.add("hidden");
      return;
    }
    if (empty) empty.classList.add("hidden");
    if (page) page.classList.remove("hidden");

    const ctx = buildContext(run);
    const banner = document.getElementById("sample-banner");
    if (banner) banner.classList.toggle("hidden", !ctx.isSample);
    const decision = decide(ctx);
    renderDecision(ctx, decision);
    renderHazard(ctx);
    renderVulnerability(ctx);
    renderExposure(ctx);
    renderFinance(ctx);
    lastCurve = ctx.curve || [];
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
    if (analysisMap) analysisMap.invalidateSize();
  });

  render();
})();
