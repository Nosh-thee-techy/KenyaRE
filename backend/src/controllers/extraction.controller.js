const { loadDocument } = require("../loaders/document.loader");
const { extractExposure } = require("../services/extraction.service");

async function extract(req, res) {
  if (!req.file) return res.status(400).json({ error: "A document is required in the 'file' field." });
  try {
    const text = await loadDocument(req.file);
    const result = await extractExposure(text, process.env.GEMINI_API_KEY);
    return res.json(result);
  } catch (error) {
    const clientError = /unsupported|parse|readable|GEMINI_API_KEY|invalid extraction/i.test(error.message)
      ? error.message
      : "Document extraction failed.";
    return res.status(422).json({ error: clientError });
  }
}

module.exports = { extract };
