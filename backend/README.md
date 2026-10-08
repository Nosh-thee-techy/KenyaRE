# Document extraction service

This request-scoped RAG service extracts exposure and financial fields from one uploaded JSON, PDF, DOCX, CSV, XLSX, or XLS document. Uploaded bytes, extracted text, chunks, embeddings, and the temporary vector store are never persisted.

## Setup

```powershell
cd backend
npm install
Copy-Item .env.example .env
# Set GEMINI_API_KEY in .env
npm start
```

`MAX_UPLOAD_BYTES` defaults to 10 MiB. The service exposes `GET /health` and `POST /api/extract`; the multipart field is `file`.

```powershell
curl.exe -X POST http://localhost:3000/api/extract `
  -F "file=@test-data/landmark-plaza.json"
```

The response is exactly the extraction object defined in `src/schemas/exposure.schema.js`. Missing values are `null`, while `vital_considerations` is always an array. Gemini is accessed through LangChain and results are parsed and validated with Zod, with one validation retry. The fixture at `test-data/landmark-plaza.json` exercises the extraction path.

Hazard modelling, vulnerability curves, financial loss calculations, and EP curves remain outside this service.
