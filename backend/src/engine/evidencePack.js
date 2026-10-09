const allowlist = require("../../data/evidence/allowlist.json");

const GEMINI_MS = 4000;
const OSM_MS = 2500;
const OSM_RADIUS_M = 1500;
const packCache = new Map();

function sourceById(id) {
  return (allowlist.sources || []).find((s) => s.id === id) || null;
}

function fallbackRows(hotspotName) {
  return (allowlist.hotspot_mechanisms || [])
    .filter((row) => !hotspotName || row.name.toLowerCase() === String(hotspotName).toLowerCase())
    .map((row) => {
      const source = sourceById(row.source_id);
      return {
        hotspot_name: row.name,
        mechanism: row.mechanism,
        year: source && /2026/.test(source.title) ? 2026 : source && /2024/.test(source.title) ? 2024 : null,
        quote: source ? source.excerpt : null,
        url: source ? source.url : null,
        source_id: row.source_id,
        extracted_by: "allowlist"
      };
    })
    .filter((row) => row.quote && row.url);
}

function parseJsonFromModel(text) {
  const stripped = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(stripped);
  } catch (_err) {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
    throw new SyntaxError("The evidence model did not return JSON.");
  }
}

function responseText(response) {
  if (!response) return "";
  if (typeof response.content === "string") return response.content;
  if (Array.isArray(response.content)) return response.content.map((part) => part.text || "").join("");
  return String(response.content || "");
}

function sanitizeExtracted(rows) {
  const allowedUrls = new Set((allowlist.sources || []).map((s) => s.url));
  const allowedIds = new Set((allowlist.sources || []).map((s) => s.id));
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      hotspot_name: row && row.hotspot_name ? String(row.hotspot_name) : null,
      mechanism: row && ["drainage", "terrain", "unknown"].includes(row.mechanism) ? row.mechanism : "unknown",
      year: row && Number.isFinite(Number(row.year)) ? Number(row.year) : null,
      quote: row && row.quote ? String(row.quote).slice(0, 360) : null,
      url: row && row.url ? String(row.url) : null,
      source_id: row && row.source_id ? String(row.source_id) : null,
      extracted_by: "gemini"
    }))
    .filter((row) => row.quote && row.url && (allowedUrls.has(row.url) || allowedIds.has(row.source_id)));
}

async function extractWithGemini(hotspotName, apiKey) {
  const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
  const model = new ChatGoogleGenerativeAI({
    apiKey,
    model: "gemini-3.8-flash",
    temperature: 0,
    json: true
  });
  const prompt = [
    "Extract structured flood-mechanism rows from ONLY the allowlisted excerpts below.",
    "Return JSON: {\"rows\":[{\"hotspot_name\",\"mechanism\",\"year\",\"quote\",\"url\",\"source_id\"}]}.",
    "mechanism must be drainage, terrain, or unknown.",
    "quote must be a short span copied from an excerpt. Do not invent URLs or hotspot names.",
    hotspotName ? `Prefer rows about ${hotspotName}.` : "Cover the named misses and hits.",
    "",
    JSON.stringify({ sources: allowlist.sources, hotspot_mechanisms: allowlist.hotspot_mechanisms }, null, 2)
  ].join("\n");
  const response = await model.invoke(prompt);
  const parsed = parseJsonFromModel(responseText(response));
  return sanitizeExtracted(parsed.rows || parsed);
}

async function withTimeout(promise, ms, fallback) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function osmDensity(lat, lon) {
  if (process.env.AI_OSM === "0") return { status: "skipped", reason: "disabled" };
  if (lat == null || lon == null) return { status: "skipped", reason: "missing_coordinates" };
  const query = `[out:json][timeout:3];(way["waterway"](around:${OSM_RADIUS_M},${lat},${lon});way["tunnel"="culvert"](around:${OSM_RADIUS_M},${lat},${lon});node["man_made"="manhole"](around:${OSM_RADIUS_M},${lat},${lon}););out count;`;
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(OSM_MS)
    });
    if (!res.ok) return { status: "unavailable", reason: `http_${res.status}` };
    const json = await res.json();
    const tags = json && json.elements && json.elements[0] && json.elements[0].tags ? json.elements[0].tags : {};
    const total = Number(tags.total || tags.ways || 0);
    return {
      status: "ok",
      radius_m: OSM_RADIUS_M,
      waterway_or_culvert_count: Number.isFinite(total) ? total : null,
      note: "OSM drain / waterway count in a 1.5 km radius. Not a capacity model."
    };
  } catch (err) {
    return { status: "unavailable", reason: err.name === "TimeoutError" ? "timeout" : "network" };
  }
}

function publicSources() {
  return (allowlist.sources || []).map((s) => ({
    id: s.id,
    title: s.title,
    url: s.url,
    what: s.what
  }));
}

async function buildEvidencePack({ hotspotName, lat, lon, apiKey }) {
  const cacheKey = `${hotspotName || "_"}:${lat}:${lon}`;
  if (packCache.has(cacheKey)) return packCache.get(cacheKey);

  const baked = fallbackRows(hotspotName);
  const useGemini = Boolean(apiKey) && process.env.AI_EVIDENCE_GEMINI === "1";
  const [geminiRows, osm] = await Promise.all([
    useGemini
      ? withTimeout(extractWithGemini(hotspotName, apiKey).catch(() => null), GEMINI_MS, null)
      : Promise.resolve(null),
    osmDensity(lat, lon)
  ]);
  const rows = geminiRows && geminiRows.length ? geminiRows : baked;
  const pack = {
    extractor: geminiRows && geminiRows.length ? "gemini+allowlist" : "allowlist",
    sources: publicSources(),
    rows,
    osm,
    note: "News and county text never become a street gauge. They only flag drainage vs terrain."
  };
  packCache.set(cacheKey, pack);
  return pack;
}

module.exports = { buildEvidencePack, fallbackRows, publicSources, osmDensity };
