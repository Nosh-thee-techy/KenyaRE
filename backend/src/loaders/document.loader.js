const path = require("node:path");
const { parse } = require("csv-parse/sync");
const mammoth = require("mammoth");
const XLSX = require("xlsx");
const { objectToText, normalizeText } = require("../utils/normalization");

const supportedExtensions = new Set([
  ".json",
  ".pdf",
  ".docx",
  ".csv",
  ".xlsx",
  ".xls",
  ".txt",
  ".md",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp"
]);

const IMAGE_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function decodeBuffer(buf) {
  if (!buf || !buf.length) return "";
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString("utf16le");
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.alloc(buf.length - 2);
    for (let i = 2; i + 1 < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    return swapped.toString("utf16le");
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString("utf8");
  }
  return buf.toString("utf8");
}

function asImage(mime, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!buf.length) return null;
  return { mime, data: buf };
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function loadPdf(buffer) {
  const { PDFParse } = require("pdf-parse");
  const data = Uint8Array.from(buffer);
  const parser = new PDFParse({ data });
  try {
    const result = await withTimeout(parser.getText(), 25000, "PDF text extraction timed out");
    const text = normalizeText(result && result.text ? result.text : "");
    if (text.length >= 40) {
      return { text, images: [] };
    }
    let images = [];
    try {
      const shots = await withTimeout(
        parser.getScreenshot({ scale: 1.25, partial: [1, 2, 3] }),
        20000,
        "PDF screenshot timed out"
      );
      const pages = (shots && shots.pages) || [];
      images = pages
        .slice(0, 3)
        .map((page) => asImage("image/png", page && page.data))
        .filter(Boolean);
    } catch (_) {
      images = [];
    }
    if (!text && !images.length) {
      throw new Error(
        "This PDF has no extractable text (it may be a scan). Paste the slip text or upload a text-based PDF/DOCX."
      );
    }
    return { text, images };
  } finally {
    try {
      await parser.destroy();
    } catch (_) {}
  }
}

/**
 * @returns {Promise<{ text: string, images: Array<{ mime: string, data: Buffer }> }>}
 */
async function loadDocument(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new Error(`Unsupported file format: ${extension || "unknown"}`);
  }
  try {
    if (IMAGE_MIME[extension]) {
      const img = asImage(IMAGE_MIME[extension], file.buffer);
      if (!img) throw new Error("Image file is empty.");
      return { text: "", images: [img] };
    }
    if (extension === ".txt" || extension === ".md") {
      return { text: normalizeText(decodeBuffer(file.buffer)), images: [] };
    }
    if (extension === ".json") {
      const parsed = JSON.parse(decodeBuffer(file.buffer));
      return { text: objectToText(parsed), images: [] };
    }
    if (extension === ".pdf") {
      return loadPdf(file.buffer);
    }
    if (extension === ".docx") {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return { text: normalizeText(result.value), images: [] };
    }
    if (extension === ".csv") {
      const rows = parse(decodeBuffer(file.buffer), {
        columns: true,
        skip_empty_lines: true,
        bom: true
      });
      return { text: objectToText(rows), images: [] };
    }
    const workbook = XLSX.read(file.buffer, { type: "buffer", cellDates: false });
    const text = workbook.SheetNames.map((sheetName) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });
      return `Sheet: ${sheetName}\n${objectToText(rows)}`;
    }).join("\n");
    return { text, images: [] };
  } catch (error) {
    throw new Error(`Could not parse ${extension} document: ${error.message}`);
  }
}

module.exports = { loadDocument, supportedExtensions };
