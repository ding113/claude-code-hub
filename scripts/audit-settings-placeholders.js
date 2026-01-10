/*
 * Audit for zh-CN placeholder strings accidentally copied into other locales' split settings.
 *
 * Rule:
 * - For each non-canonical locale, if a leaf string equals the canonical (zh-CN) leaf string at
 *   the same key path, consider it a "placeholder candidate".
 *
 * Output includes:
 * - locale
 * - relFile (relative to messages/<locale>/settings)
 * - key (full settings key path, e.g. providers.form.maxRetryAttempts.label)
 */
const fs = require("node:fs");
const path = require("node:path");
const sync = require("./sync-settings-keys.js");

const CANONICAL = "zh-CN";

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isObject(v)) Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

function listJsonFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".json")) out.push(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

function fileToKeyPrefix(relFile) {
  const segs = relFile.replace(/\.json$/, "").split(path.sep);
  if (segs[segs.length - 1] === "strings") return segs.slice(0, -1).join(".");
  return segs.join(".");
}

function getSettingsDir(messagesDir, locale) {
  return path.join(messagesDir, locale, "settings");
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function hasHanChars(s) {
  return /[\u4E00-\u9FFF]/.test(s);
}

function findSettingsPlaceholders({ messagesDir, locales }) {
  const root = messagesDir || path.join(process.cwd(), "messages");
  const targets = locales || ["en", "ja", "ru", "zh-TW"];

  const cnDir = getSettingsDir(root, CANONICAL);
  const cnFiles = listJsonFiles(cnDir).map((p) => path.relative(cnDir, p));

  const rows = [];
  for (const locale of targets) {
    const localeDir = getSettingsDir(root, locale);
    for (const rel of cnFiles) {
      const cnPath = path.join(cnDir, rel);
      const tPath = path.join(localeDir, rel);
      if (!fs.existsSync(tPath)) continue;

      const prefix = fileToKeyPrefix(rel);
      const cnObj = loadJson(cnPath);
      const tObj = loadJson(tPath);
      const cnFlat = flatten(cnObj);
      const tFlat = flatten(tObj);

      for (const [leafKey, cnVal] of Object.entries(cnFlat)) {
        const tVal = tFlat[leafKey];
        if (typeof cnVal !== "string" || typeof tVal !== "string") continue;
        if (!hasHanChars(cnVal)) continue;
        if (tVal !== cnVal) continue;

        const fullKey = prefix
          ? leafKey
            ? `${prefix}.${leafKey}`
            : prefix
          : leafKey;

        rows.push({
          locale,
          relFile: rel,
          key: fullKey,
          value: tVal,
        });
      }
    }
  }

  return { rows, byLocaleCount: rows.reduce((acc, r) => ((acc[r.locale] = (acc[r.locale] || 0) + 1), acc), {}) };
}

function run(argv) {
  const fail = argv.includes("--fail");
  const messagesDirArg = argv.find((a) => a.startsWith("--messagesDir="));
  const messagesDir = messagesDirArg ? messagesDirArg.split("=", 2)[1] : undefined;

  const report = findSettingsPlaceholders({ messagesDir });
  const total = report.rows.length;

  if (total === 0) {
    return {
      exitCode: 0,
      lines: ["OK: no zh-CN placeholder candidates found in split settings."],
    };
  }

  const lines = [`Found ${total} zh-CN placeholder candidates:`];
  for (const r of report.rows) {
    lines.push(`${r.locale}\t${r.relFile}\t${r.key}`);
  }

  return { exitCode: fail ? 1 : 0, lines };
}

module.exports = {
  findSettingsPlaceholders,
  flatten,
  listJsonFiles,
  fileToKeyPrefix,
  run,
};

if (require.main === module) {
  // Validate script API compatibility: sync script must remain require()-able.
  if (!sync || typeof sync.loadSplitSettings !== "function") {
    throw new Error("scripts/sync-settings-keys.js exports are not available (expected loadSplitSettings)");
  }
  const out = run(process.argv.slice(2));
  for (const line of out.lines) console.log(line); // eslint-disable-line no-console
  process.exit(out.exitCode);
}
