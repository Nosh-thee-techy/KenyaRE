const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const { Document } = require("@langchain/core/documents");
const { chunkText } = require("../utils/normalization");

async function retrieveContext(text, apiKey) {
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error("The uploaded document contains no readable text");
  if (!apiKey) return chunks.join("\n\n");

  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey,
    model: "gemini-embedding-001"
  });
  const store = await MemoryVectorStore.fromDocuments(
    chunks.map((pageContent, index) => new Document({ pageContent, metadata: { index } })),
    embeddings
  );
  const queries = [
    "property name reference address coordinates latitude longitude elevation",
    "construction class housing building type floor area floors height basements plant",
    "TIV total insured value sum insured cost per square metre deductible financial terms"
  ];
  const results = await Promise.all(queries.map((query) => store.similaritySearch(query, 4)));
  const unique = new Map();
  results.flat().forEach((document) => unique.set(document.metadata.index, document.pageContent));
  return [...unique.entries()].sort(([a], [b]) => a - b).map(([, content]) => content).join("\n\n");
}

module.exports = { retrieveContext };
