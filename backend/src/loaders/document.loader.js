const path = require("node:path");
const { parse } = require("csv-parse/sync");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const XLSX = require("xlsx");
const { objectToText, normalizeText } = require("../utils/normalization");

const supportedExtensions = new Set([".json", ".pdf", ".docx", ".csv", ".xlsx", ".xls", ".txt", ".md"]);

async function loadDocument(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new Error(`Unsupported file format: ${extension || "unknown"}`);
  }
  try {
    if (extension === ".txt" || extension === ".md") {
      return normalizeText(file.buffer.toString("utf8"));
    }
    if (extension === ".json") {
      const parsed = JSON.parse(file.buffer.toString("utf8"));
      return objectToText(parsed);
    }
    if (extension === ".pdf") {
      const result = await pdfParse(file.buffer);
      return normalizeText(result.text);
    }
    if (extension === ".docx") {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return normalizeText(result.value);
    }
    if (extension === ".csv") {
      const rows = parse(file.buffer.toString("utf8"), { columns: true, skip_empty_lines: true, bom: true });
      return objectToText(rows);
    }
    const workbook = XLSX.read(file.buffer, { type: "buffer", cellDates: false });
    return workbook.SheetNames.map((sheetName) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });
      return `Sheet: ${sheetName}\n${objectToText(rows)}`;
    }).join("\n");
  } catch (error) {
    throw new Error(`Could not parse ${extension} document: ${error.message}`);
  }
}

module.exports = { loadDocument, supportedExtensions };
