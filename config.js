"use strict";

/**
 * Watchlog server configuration.
 *
 * Every value can also be overridden with an environment variable (handy for
 * Docker / systemd), but you can just edit the defaults here if you prefer a
 * plain config file.
 *
 * The only value you normally need to change for a real deployment is
 * `baseUrl` — set it to the domain you bought, e.g. "https://watchlog.example.com".
 */

const config = {
  // Public URL where this instance is reachable from the outside.
  // Used to build the shareable "your watchlog" links shown after an upload.
  // Change this to your own domain once you have one. No trailing slash.
  baseUrl: process.env.BASE_URL || "http://localhost:3000",

  // Network interface & port the server listens on.
  // Behind a reverse proxy (nginx/Caddy) keep 127.0.0.1; for direct exposure
  // use 0.0.0.0. The port here is the internal port, not necessarily the
  // public one in `baseUrl`.
  host: process.env.HOST || "0.0.0.0",
  port: parseInt(process.env.PORT || "3000", 10),

  // How long an uploaded watchlog stays available before it is automatically
  // deleted from the server. After this window the link stops working and the
  // user has to upload their file again.
  retentionMinutes: parseInt(process.env.RETENTION_MINUTES || "20", 10),

  // Maximum accepted upload size, in megabytes.
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || "15", 10),

  // Where temporary uploads are stored on disk. Cleared automatically; also
  // wiped of anything stale on startup. Relative paths resolve from the
  // project root.
  uploadDir: process.env.UPLOAD_DIR || "server/uploads",
};

module.exports = config;
