function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n/g, "\n")
    .trim();
}

function objectToText(value, prefix = "") {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((item, index) => objectToText(item, `${prefix}[${index}]`)).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => objectToText(item, prefix ? `${prefix}.${key}` : key))
      .filter(Boolean)
      .join("\n");
  }
  return `${prefix}: ${value}`;
}

function chunkText(text, chunkSize = 1800, overlap = 250) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const chunks = [];
  for (let start = 0; start < normalized.length; start += chunkSize - overlap) {
    chunks.push(normalized.slice(start, start + chunkSize));
    if (start + chunkSize >= normalized.length) break;
  }
  return chunks;
}

module.exports = { normalizeText, objectToText, chunkText };
