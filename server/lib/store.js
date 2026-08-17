"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * Ephemeral, on-disk store for uploaded watchlogs.
 *
 * Each upload gets a random id and is written as `<id>.json`. An in-memory
 * registry tracks expiry. A background sweep deletes anything past its
 * retention window, and the registry is rebuilt from disk (using file mtime)
 * on startup so a restart never leaks old uploads and expiry is still enforced.
 */
class Store {
  constructor({ uploadDir, retentionMinutes }) {
    this.uploadDir = uploadDir;
    this.retentionMs = retentionMinutes * 60 * 1000;
    this.registry = new Map(); // id -> { expiresAt: number }
    fs.mkdirSync(this.uploadDir, { recursive: true });
    this._reconcileFromDisk();
  }

  _filePath(id) {
    return path.join(this.uploadDir, id + ".json");
  }

  // Rebuild the registry from files already on disk, honoring the original
  // retention window via each file's modified time. Expired files are removed.
  _reconcileFromDisk() {
    let entries = [];
    try {
      entries = fs.readdirSync(this.uploadDir);
    } catch (_e) {
      return;
    }
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const id = entry.slice(0, -".json".length);
      const full = path.join(this.uploadDir, entry);
      let mtime;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch (_e) {
        continue;
      }
      const expiresAt = mtime + this.retentionMs;
      if (expiresAt <= now) {
        this._safeUnlink(full);
      } else {
        this.registry.set(id, { expiresAt });
      }
    }
  }

  _safeUnlink(full) {
    try {
      fs.unlinkSync(full);
    } catch (_e) {
      /* already gone */
    }
  }

  // Persist a validated data object, returning { id, expiresAt }.
  create(data) {
    const id = crypto.randomBytes(9).toString("hex"); // 18 hex chars
    const expiresAt = Date.now() + this.retentionMs;
    fs.writeFileSync(this._filePath(id), JSON.stringify(data), "utf8");
    this.registry.set(id, { expiresAt });
    return { id, expiresAt };
  }

  // Return { data, expiresAt } for a live id, or null if missing/expired.
  get(id) {
    if (!/^[a-f0-9]{6,64}$/.test(id)) return null;
    const meta = this.registry.get(id);
    if (!meta) return null;
    if (meta.expiresAt <= Date.now()) {
      this.remove(id);
      return null;
    }
    let raw;
    try {
      raw = fs.readFileSync(this._filePath(id), "utf8");
    } catch (_e) {
      this.registry.delete(id);
      return null;
    }
    return { data: JSON.parse(raw), expiresAt: meta.expiresAt };
  }

  remove(id) {
    this.registry.delete(id);
    this._safeUnlink(this._filePath(id));
  }

  // Delete everything that has passed its expiry. Returns the count removed.
  sweep() {
    const now = Date.now();
    let removed = 0;
    for (const [id, meta] of this.registry.entries()) {
      if (meta.expiresAt <= now) {
        this.remove(id);
        removed++;
      }
    }
    return removed;
  }

  startSweeper(intervalMs = 60 * 1000) {
    if (this._timer) return;
    this._timer = setInterval(() => this.sweep(), intervalMs);
    if (this._timer.unref) this._timer.unref();
  }
}

module.exports = { Store };
