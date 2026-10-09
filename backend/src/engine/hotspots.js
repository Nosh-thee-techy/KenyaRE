const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("csv-parse/sync");

const CSV_PATH = path.join(__dirname, "..", "..", "data", "nairobi_hotspots_geocoded.csv");
const RADIUS_KM = 2;
const BLIND_SCORE_MAX = 0.08;

const KIT_NAMED_HITS = new Set(["Kiambiu", "Dandora", "Kayole", "Njiru", "Mwiki", "Mathare"]);
const KIT_NAMED_MISSES = new Set(["Kibera", "Westlands", "Lavington", "Kitisuru"]);

let cachedList = null;
let cachedGate = null;

function haversineKm(lat1, lon1, lat2, lon2) {
  const r = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function loadHotspots() {
  if (cachedList) return cachedList;
  const raw = fs.readFileSync(CSV_PATH, "utf8");
  cachedList = parse(raw, { columns: true, skip_empty_lines: true, trim: true }).map((row) => ({
    name: String(row.name || "").trim(),
    lat: Number(row.lat),
    lon: Number(row.lon)
  })).filter((row) => row.name && Number.isFinite(row.lat) && Number.isFinite(row.lon));
  return cachedList;
}

function kitFallbackClass(name) {
  if (KIT_NAMED_MISSES.has(name)) return "blinded";
  if (KIT_NAMED_HITS.has(name)) return "hit";
  return "unclassified";
}

function compactHotspot(row) {
  return {
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    class: row.class,
    kit_note: KIT_NAMED_MISSES.has(row.name)
      ? "kit-named drainage miss"
      : KIT_NAMED_HITS.has(row.name)
        ? "kit-named Eastlands hit"
        : "classify from TIFF or leave unclassified",
    common: row.common || null,
    extreme: row.extreme || null,
    max_score: row.max_score
  };
}

async function samplePair(sampleSusceptibility, lat, lon) {
  const common = await sampleSusceptibility("common", lat, lon);
  const extreme = await sampleSusceptibility("extreme", lat, lon);
  const scores = [common, extreme]
    .filter((s) => s && s.status === "ok" && s.value != null)
    .map((s) => s.value);
  const maxScore = scores.length ? Math.max(...scores) : null;
  const allMissing = [common, extreme].every((s) => !s || s.status !== "ok");
  return { common, extreme, maxScore, allMissing };
}

async function classifyHotspots(sampleSusceptibility) {
  if (cachedGate) return cachedGate;
  const list = loadHotspots();
  let sampledOk = 0;
  const classified = [];

  for (const row of list) {
    let entry = {
      ...row,
      class: kitFallbackClass(row.name),
      max_score: null,
      common: null,
      extreme: null
    };
    if (typeof sampleSusceptibility === "function") {
      try {
        const pair = await samplePair(sampleSusceptibility, row.lat, row.lon);
        entry.common = pair.common && pair.common.status ? { status: pair.common.status, value: pair.common.value } : null;
        entry.extreme = pair.extreme && pair.extreme.status ? { status: pair.extreme.status, value: pair.extreme.value } : null;
        if (!pair.allMissing) {
          sampledOk += 1;
          entry.max_score = pair.maxScore;
          if (pair.allMissing || pair.maxScore == null || pair.maxScore < BLIND_SCORE_MAX) {
            entry.class = "blinded";
          } else {
            entry.class = "hit";
          }
        }
      } catch (_err) {
        entry.class = kitFallbackClass(row.name);
      }
    }
    classified.push(entry);
  }

  const source = sampledOk >= 12 ? "tiff_sample" : "kit_labels";
  if (source === "kit_labels") {
    classified.forEach((row) => {
      row.class = kitFallbackClass(row.name);
    });
  }

  cachedGate = {
    classification_source: source,
    sampled_ok: sampledOk,
    radius_km: RADIUS_KM,
    blind_score_max: BLIND_SCORE_MAX,
    blinded: classified.filter((r) => r.class === "blinded").map(compactHotspot),
    hits: classified.filter((r) => r.class === "hit").map(compactHotspot),
    unclassified: classified.filter((r) => r.class === "unclassified").map(compactHotspot),
    all: classified.map(compactHotspot)
  };
  return cachedGate;
}

function nearestOf(lat, lon, rows) {
  if (!rows || !rows.length || lat == null || lon == null) return null;
  let best = null;
  rows.forEach((row) => {
    const distance_km = Math.round(haversineKm(lat, lon, row.lat, row.lon) * 1000) / 1000;
    if (!best || distance_km < best.distance_km) {
      best = { ...row, distance_km };
    }
  });
  return best;
}

async function gatePin(lat, lon, sampleSusceptibility) {
  const book = await classifyHotspots(sampleSusceptibility);
  const nearest_blinded = nearestOf(lat, lon, book.blinded);
  const nearest_hotspot = nearestOf(lat, lon, book.all);
  return {
    radius_km: RADIUS_KM,
    blind_score_max: BLIND_SCORE_MAX,
    classification_source: book.classification_source,
    sampled_ok: book.sampled_ok,
    in_blind_radius: Boolean(nearest_blinded && nearest_blinded.distance_km <= RADIUS_KM),
    nearest_blinded,
    nearest_hotspot,
    blinded_count: book.blinded.length,
    hit_count: book.hits.length,
    blinded: book.blinded,
    hits: book.hits,
    unclassified: book.unclassified
  };
}

function resetHotspotCache() {
  cachedGate = null;
}

module.exports = {
  RADIUS_KM,
  BLIND_SCORE_MAX,
  KIT_NAMED_HITS,
  KIT_NAMED_MISSES,
  haversineKm,
  loadHotspots,
  classifyHotspots,
  gatePin,
  resetHotspotCache
};
