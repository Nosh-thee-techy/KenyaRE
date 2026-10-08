const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { exposureSchema } = require("../schemas/exposure.schema");
const { extractionPrompt } = require("../prompts/extraction.prompt");
const { retrieveContext } = require("./rag.service");

async function invokeGemini(context, apiKey, validationError = "") {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const model = new ChatGoogleGenerativeAI({
    apiKey,
    model: "gemini-3.8-flash",
    temperature: 0
  });
  const response = await model.invoke(extractionPrompt(context, validationError));
  const text = typeof response.content === "string"
    ? response.content
    : response.content.map((part) => part.text || "").join("");
  const jsonText = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(jsonText);
}

async function extractExposure(text, apiKey) {
  const context = await retrieveContext(text, apiKey);
  let validationError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return exposureSchema.parse(await invokeGemini(context, apiKey, validationError));
    } catch (error) {
      validationError = error instanceof SyntaxError ? "The response was not valid JSON." : error.message;
      if (attempt === 1) throw new Error(`Gemini returned invalid extraction data: ${validationError}`);
    }
  }
  throw new Error("Extraction failed");
}

module.exports = { extractExposure };
