"use strict";

const vm = require("vm");

/**
 * Turn an uploaded set of files into a validated, plain-data APP_DATA object
 * the viewer understands: { series, history, generatedAt }.
 *
 * Accepted inputs (a user may drop a whole folder — order does not matter):
 *   - A CrunchyExporter `history.json`  (https://github.com/ruflas/CrunchyExporter)
 *       { last_sync, episodes: [ { series_id, series_title, season_number,
 *         episode_number, episode_title, episode_id, watched_at,
 *         fully_watched } ], overrides? }
 *     This is the primary path; the export is converted into APP_DATA here.
 *   - An `export_log.json` (metadata only) — used, if present, as a fallback
 *     "generated at" date. Ignored otherwise.
 *   - A pre-formatted APP_DATA `.json` or `data.js` (backward compatible).
 *   - Anything else in the folder (e.g. animelist.xml) is ignored.
 *
 * `files` is an array of { buffer, originalname }.
 * Throws an Error with a human-readable `.message` on any problem.
 */
function parseUploads(files) {
  if (!files || !files.length) {
    throw new Error("No files were uploaded.");
  }

  // Parse whatever we can into JS objects, remembering the filename.
  const parsed = [];
  for (const f of files) {
    const obj = tryParseOne(f.buffer, f.originalname);
    if (obj !== undefined) parsed.push({ name: (f.originalname || "").toLowerCase(), obj });
  }
  if (!parsed.length) {
    throw new Error("None of the uploaded files could be read as JSON or a data.js export.");
  }

  // 1) CrunchyExporter history.json — richest source, so prefer it.
  const history = parsed.find((p) => p.obj && Array.isArray(p.obj.episodes));
  if (history) {
    const log = parsed.find((p) => p.obj && (p.obj.last_export || p.obj.targets));
    return validate(convertCrunchyExport(history.obj, log && log.obj));
  }

  // 2) Already in APP_DATA shape (or a data.js that produced it).
  const app = parsed.find(
    (p) => p.obj && Array.isArray(p.obj.series) && Array.isArray(p.obj.history)
  );
  if (app) return validate(app.obj);

  throw new Error(
    "Could not find a Crunchyroll history.json (with an `episodes` array) " +
      "or a watchlog export in the upload."
  );
}

// Try JSON first; if that fails, try evaluating it as a data.js. Returns the
// parsed object, or undefined if this file is not usable data (e.g. XML).
function tryParseOne(buffer, name) {
  const text = buffer.toString("utf8");
  const lower = (name || "").toLowerCase();

  if (lower.endsWith(".xml")) return undefined; // animelist.xml etc.

  try {
    return JSON.parse(text);
  } catch (_e) {
    /* not JSON, maybe a data.js */
  }
  if (lower.endsWith(".js") || /APP_DATA/.test(text)) {
    return parseDataJs(text);
  }
  return undefined;
}

function parseDataJs(text) {
  // Evaluate the script in an isolated context (no require/process/global) and
  // read back APP_DATA as the script's completion value, then strip anything
  // non-data by round-tripping through JSON.
  const sandbox = { window: {}, APP_DATA: undefined };
  vm.createContext(sandbox);
  let result;
  try {
    result = vm.runInContext(
      text + "\n; (typeof APP_DATA !== 'undefined' ? APP_DATA : window.APP_DATA);",
      sandbox,
      { timeout: 2000, displayErrors: false }
    );
  } catch (_e) {
    return undefined;
  }
  if (!result) return undefined;
  try {
    return JSON.parse(JSON.stringify(result));
  } catch (_e) {
    return undefined;
  }
}

/**
 * Convert a CrunchyExporter history.json into APP_DATA.
 *
 * Crunchyroll reuses the same series_id across every season, so all seasons of
 * a show are grouped into one series card; `seasonCount` reports how many
 * distinct seasons were seen. Each episode_id is unique (the exporter dedupes),
 * so one row == one watched episode.
 */
function convertCrunchyExport(history, log) {
  const episodes = Array.isArray(history.episodes) ? history.episodes : [];
  const overrides = history.overrides || {};

  // Best-effort title overrides (GUI edits). Keys look like "seriesId::season";
  // we apply the title to the whole series_id, which is what a rename means.
  const titleOverride = {};
  for (const [key, ov] of Object.entries(overrides)) {
    if (ov && ov.title) titleOverride[String(key).split("::")[0]] = ov.title;
  }

  const fallbackDate = history.last_sync || (log && log.last_export) || null;
  const seriesMap = new Map();
  const historyOut = [];

  for (const ep of episodes) {
    const sid = String(ep.series_id != null ? ep.series_id : "");
    if (!sid) continue;
    const title = titleOverride[sid] || ep.series_title || "Unknown title";
    const sn = ep.season_number != null ? ep.season_number : null;
    const en = normalizeEpisodeNumber(ep.episode_number);
    const watchedAt = ep.watched_at || null;
    const wa = watchedAt || fallbackDate;

    let s = seriesMap.get(sid);
    if (!s) {
      s = { id: sid, title, seasons: new Set(), count: 0, first: null, last: null };
      seriesMap.set(sid, s);
    }
    s.title = title;
    if (sn != null) s.seasons.add(sn);
    s.count++;
    if (watchedAt) {
      if (!s.first || watchedAt < s.first) s.first = watchedAt;
      if (!s.last || watchedAt > s.last) s.last = watchedAt;
    }

    historyOut.push({
      sid,
      t: title,
      sn,
      en,
      et: ep.episode_title || "",
      wa,
      fw: !!ep.fully_watched,
    });
  }

  const series = Array.from(seriesMap.values()).map((s) => ({
    id: s.id,
    title: s.title,
    episodeCount: s.count,
    seasonCount: s.seasons.size || 1,
    firstWatched: s.first || fallbackDate,
    lastWatched: s.last || fallbackDate,
  }));

  // Newest first for the timeline; entries without a timestamp sink to the end.
  historyOut.sort((a, b) => {
    if (!a.wa && !b.wa) return 0;
    if (!a.wa) return 1;
    if (!b.wa) return -1;
    return a.wa < b.wa ? 1 : a.wa > b.wa ? -1 : 0;
  });

  return {
    series,
    history: historyOut,
    generatedAt: fallbackDate || new Date().toISOString(),
  };
}

// episode_number is a float in the export (0 for movies, e.g. 5.5 for specials).
// Keep half-episodes as-is, collapse whole floats like 12.0 to 12.
function normalizeEpisodeNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return num;
}

function validate(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Uploaded data is not an object.");
  }
  if (!Array.isArray(data.series)) {
    throw new Error("Parsed data is missing a `series` array.");
  }
  if (!Array.isArray(data.history)) {
    throw new Error("Parsed data is missing a `history` array.");
  }
  if (!data.series.length) {
    throw new Error("The export contains no watched series.");
  }
  if (!data.generatedAt) data.generatedAt = new Date().toISOString();
  return { series: data.series, history: data.history, generatedAt: data.generatedAt };
}

module.exports = { parseUploads, convertCrunchyExport };
