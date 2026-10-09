const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage } = require("@langchain/core/messages");
const { exposureSchema } = require("../schemas/exposure.schema");
const { extractionPrompt } = require("../prompts/extraction.prompt");
const { retrieveContext } = require("./rag.service");

const FULL_TEXT_LIMIT = 24000;
const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash"
];

function parseJsonFromModel(text) {
  const stripped = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch (_) {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(stripped.slice(start, end + 1));
    }
    throw new SyntaxError("The response was not valid JSON.");
  }
}

function responseText(response) {
  if (!response) return "";
  if (typeof response.content === "string") return response.content;
  if (Array.isArray(response.content)) {
    return response.content.map((part) => part.text || "").join("");
  }
  return String(response.content || "");
}

function imageParts(images) {
  return (images || [])
    .map((img) => {
      if (!img || !img.data) return null;
      const b64 = Buffer.isBuffer(img.data)
        ? img.data.toString("base64")
        : Buffer.from(img.data).toString("base64");
      if (!b64) return null;
      return {
        type: "image_url",
        image_url: `data:${img.mime || "image/png"};base64,${b64}`
      };
    })
    .filter(Boolean);
}

function intakeContext(text, images) {
  const sliced = String(text || "").slice(0, FULL_TEXT_LIMIT);
  if (sliced) return sliced;
  if (images && images.length) {
    return "The broker slip was provided as page image(s). Extract only values visible in the images. Never invent GPS, TIV, GFA, floors, height, or construction class.";
  }
  return "";
}

function isRetryableModelError(err) {
  const msg = err && err.message ? String(err.message) : String(err || "");
  return /429|404|403|503|529|not found|unavailable|RESOURCE_EXHAUSTED|quota|timeout|timed out|model/i.test(
    msg
  );
}

async function invokeGemini(context, apiKey, validationError = "", images = [], modelName) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const model = new ChatGoogleGenerativeAI({
    apiKey,
    model: modelName,
    temperature: 0,
    json: true
  });
  const prompt = extractionPrompt(context, validationError);
  const parts = imageParts(images);
  const response = parts.length
    ? await model.invoke([new HumanMessage({ content: [{ type: "text", text: prompt }, ...parts] })])
    : await model.invoke(prompt);
  return parseJsonFromModel(responseText(response));
}

async function extractExposure(text, apiKey, options = {}) {
  const images = options.images || [];
  const skipRag = options.skipRag !== false;
  let context;
  if (skipRag) {
    context = intakeContext(text, images);
    if (!context) throw new Error("The uploaded document contains no readable text");
  } else {
    try {
      context = await retrieveContext(text || "", apiKey);
    } catch (error) {
      if (images.length) {
        context = intakeContext("", images);
      } else {
        throw error;
      }
    }
  }

  let lastErr;
  for (const modelName of GEMINI_MODELS) {
    try {
      const parsed = await invokeGemini(context, apiKey, "", images, modelName);
      return exposureSchema.parse(parsed);
    } catch (err) {
      lastErr = err;
      if (!isRetryableModelError(err)) throw err;
    }
  }
  throw lastErr || new Error("Gemini extraction failed");
}

module.exports = { extractExposure, GEMINI_MODELS };
