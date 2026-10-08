const express = require("express");
const multer = require("multer");
const path = require("node:path");
const { extract } = require("../controllers/extraction.controller");
const { supportedExtensions } = require("../loaders/document.loader");

const maxBytes = Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxBytes },
  fileFilter: (_req, file, callback) => {
    if (!supportedExtensions.has(path.extname(file.originalname || "").toLowerCase())) {
      return callback(new Error("Unsupported file format."));
    }
    return callback(null, true);
  }
});

const router = express.Router();
router.post("/extract", upload.single("file"), extract);
module.exports = router;
