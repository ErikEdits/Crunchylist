"use strict";

const vm = require("vm");

/**
 * Turn an uploaded file (raw Buffer) into a validated, plain-data APP_DATA
 * object.
 *
 * Two input shapes are accepted:
 *   - `.json` — a JSON document `{ series, history, generatedAt }`
 *   - `.js`   — a `data.js` file that assigns a global `APP_DATA` (const/var/
 *               window.APP_DATA). It is evaluated in an isolated VM context
 *               with no Node globals (no require/process) and a short timeout,
 *               then re-serialized to plain JSON so nothing executable survives.
 *
 * Throws an Error with a human-readable `.message` on any problem; the caller
 * maps that to a 400 response.
 */
function parseUpload(buffer, originalName) {
  const text = buffer.toString("utf8");
  const name = (originalName || "").toLowerCase();

  let data;
  if (name.endsWith(".json")) {
    data = parseJson(text);
  } else if (name.endsWith(".js")) {
    data = parseDataJs(text);
  } else {
    // Unknown extension: try JSON first, then JS.
    try {
      data = parseJson(text);
    } catch (_e) {
      data = parseDataJs(text);
    }
  }

  return validate(data);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("File is not valid JSON.");
  }
}

function parseDataJs(text) {
  // Evaluate the script and read back its APP_DATA. The completion value of the
  // script (the trailing `APP_DATA;` expression) is returned even when it was
  // declared with `const`. The sandbox is empty, so require/process/global are
  // unavailable, and the timeout stops any accidental long-running code.
  const sandbox = { window: {}, APP_DATA: undefined };
  vm.createContext(sandbox);
  let result;
  try {
    result = vm.runInContext(
      text + "\n; (typeof APP_DATA !== 'undefined' ? APP_DATA : window.APP_DATA);",
      sandbox,
      { timeout: 2000, displayErrors: false }
    );
  } catch (e) {
    throw new Error("Could not read APP_DATA from the uploaded .js file.");
  }
  if (!result) {
    throw new Error("The uploaded .js file does not define APP_DATA.");
  }
  // Strip anything non-data by round-tripping through JSON.
  try {
    return JSON.parse(JSON.stringify(result));
  } catch (e) {
    throw new Error("APP_DATA could not be serialized to plain data.");
  }
}

function validate(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Uploaded data is not an object.");
  }
  if (!Array.isArray(data.series)) {
    throw new Error("Uploaded data is missing a `series` array.");
  }
  if (!Array.isArray(data.history)) {
    throw new Error("Uploaded data is missing a `history` array.");
  }
  if (!data.generatedAt) {
    // Not fatal — fall back to now so the viewer's "Updated" stat still works.
    data.generatedAt = new Date().toISOString();
  }
  return { series: data.series, history: data.history, generatedAt: data.generatedAt };
}

module.exports = { parseUpload };
