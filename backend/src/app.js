require("dotenv").config();
const express = require("express");
const extractionRoutes = require("./routes/extraction.routes");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api", extractionRoutes);
app.use((error, _req, res, _next) => {
  if (error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Uploaded file exceeds the size limit." });
  if (error.message === "Unsupported file format.") return res.status(415).json({ error: error.message });
  return res.status(400).json({ error: "Invalid upload request." });
});

module.exports = app;
