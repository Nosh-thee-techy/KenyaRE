const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage } = require("@langchain/core/messages");
const { exposureSchema } = require("../schemas/exposure.schema");
const { extractionPrompt } = require("../prompts/extraction.prompt");
const { retrieveContext } = require("./rag.service");

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

async function invokeGemini(context, apiKey, validationError = "", images = []) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const model = new ChatGoogleGenerativeAI({
    apiKey,
    model: "gemini-3.8-flash",
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
  let context;
  try {
    context = await retrieveContext(text || "", apiKey);
  } catch (error) {
    if (images.length) {
      context =
        "The broker slip was provided as page image(s). Extract only values visible in the images. Never invent GPS, TIV, GFA, floors, height, or construction class.";
    } else {
      throw error;
    }
  }
  let validationError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return exposureSchema.parse(await invokeGemini(context, apiKey, validationError, images));
    } catch (error) {
      validationError =
        error instanceof SyntaxError ? "The response was not valid JSON." : error.message;
      if (attempt === 1) throw new Error(`Gemini returned invalid extraction data: ${validationError}`);
    }
  }
  throw new Error("Extraction failed");
}

module.exports = { extractExposure };
