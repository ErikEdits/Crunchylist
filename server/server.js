"use strict";

const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");

const config = require("../config");
const { parseUploads } = require("./lib/parseData");
const { Store } = require("./lib/store");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const UPLOAD_DIR = path.isAbsolute(config.uploadDir)
  ? config.uploadDir
  : path.join(ROOT, config.uploadDir);

const store = new Store({
  uploadDir: UPLOAD_DIR,
  retentionMinutes: config.retentionMinutes,
});
store.startSweeper();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 20 },
});

const app = express();
app.disable("x-powered-by");

// ---- Static assets (upload page, viewer assets) ----
// Served from /assets so they never collide with the /w/:id viewer routes.
app.use("/assets", express.static(PUBLIC_DIR, { index: false }));

// ---- Landing / upload page ----
app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// Expose a couple of config values the upload page needs (retention window).
app.get("/api/config", (_req, res) => {
  res.json({ retentionMinutes: config.retentionMinutes, maxUploadMb: config.maxUploadMb });
});

// ---- Upload handler ----
// Accepts one or more files (e.g. a whole CrunchyExporter `data` folder).
app.post("/upload", upload.array("files", 20), (req, res) => {
  const files = req.files || [];
  if (!files.length) {
    return res.status(400).json({ error: "No files were uploaded." });
  }
  let data;
  try {
    data = parseUploads(files);
  } catch (e) {
    return res.status(400).json({ error: e.message || "Could not read the uploaded files." });
  }
  const { id, expiresAt } = store.create(data);
  res.json({
    id,
    url: `${config.baseUrl}/w/${id}`,
    path: `/w/${id}`,
    expiresAt,
    expiresInMinutes: config.retentionMinutes,
  });
});

// Multer / body errors (e.g. file too large) land here.
app.use((err, _req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File is larger than ${config.maxUploadMb} MB.` });
  }
  if (err) {
    return res.status(400).json({ error: err.message || "Upload failed." });
  }
  next();
});

// ---- Viewer ----
const VIEWER_HTML = fs.readFileSync(path.join(PUBLIC_DIR, "viewer.html"), "utf8");
const EXPIRED_HTML = fs.readFileSync(path.join(PUBLIC_DIR, "expired.html"), "utf8");

app.get("/w/:id", (req, res) => {
  const entry = store.get(req.params.id);
  if (!entry) {
    return res.status(410).type("html").send(EXPIRED_HTML);
  }
  const injected =
    `<script>window.APP_DATA=${jsonForScript(entry.data)};` +
    `window.WATCHLOG_EXPIRES_AT=${entry.expiresAt};</script>`;
  const html = VIEWER_HTML.replace("<!--APP_DATA-->", injected);
  res.type("html").send(html);
});

// Escape "<" so a title containing "</script>" can't break out of the tag.
function jsonForScript(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

app.listen(config.port, config.host, () => {
  // eslint-disable-next-line no-console
  console.log(
    `Watchlog running on http://${config.host}:${config.port}  ` +
      `(public: ${config.baseUrl}, retention: ${config.retentionMinutes} min)`
  );
});
