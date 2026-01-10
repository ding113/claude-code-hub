/*
 * Audit for zh-CN placeholder strings accidentally copied into other locales' split settings.
 *
 * Rule:
 * - For each non-canonical locale, if a leaf string equals the canonical (zh-CN) leaf string at
 *   the same key path, consider it a "placeholder candidate".
 *
 * Output includes:
 * - locale
 * - relFile (relative to messages/<locale>, e.g. settings/config.json or dashboard.json)
 * - key (full key path, prefixed by file name, e.g. config.form.enableHttp2Desc)
 * - value (target value, equals zh-CN)
 * - reason (stable machine-readable string)
 */
const fs = require("node:fs");
const path = require("node:path");
const sync = require("./sync-settings-keys.js");

const CANONICAL = "zh-CN";
const DEFAULT_TARGET_LOCALES = ["en", "ja", "ru", "zh-TW"];
const SCOPES = ["settings", "dashboard", "myUsage"];

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

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function hasHanChars(s) {
  return /[\u4E00-\u9FFF]/.test(s);
}

function normalizeScopes(scopes) {
  if (typeof scopes === "string") return normalizeScopes([scopes]);
  if (!scopes || scopes.length === 0) return ["settings"];
  const normalized = scopes
    .flatMap((s) => String(s).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = normalized.filter((s) => !SCOPES.includes(s));
  if (unknown.length > 0) {
    throw new Error(`Unknown scope(s): ${unknown.join(", ")} (supported: ${SCOPES.join(", ")})`);
  }
  return normalized;
}

function normalizeLocales(locales) {
  if (typeof locales === "string") return normalizeLocales([locales]);
  if (!locales || locales.length === 0) return DEFAULT_TARGET_LOCALES;
  return locales
    .flatMap((s) => String(s).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

function listCanonicalFilesForScope(messagesRoot, scope) {
  if (scope === "settings") {
    const cnDir = path.join(messagesRoot, CANONICAL, "settings");
    return listJsonFiles(cnDir).map((p) => {
      const rel = path.relative(cnDir, p);
      return {
        relFile: rel,
        canonicalPath: p,
        keyPrefix: fileToKeyPrefix(rel),
      };
    });
  }

  const file = `${scope}.json`;
  const canonicalPath = path.join(messagesRoot, CANONICAL, file);
  if (!fs.existsSync(canonicalPath)) return [];
  return [{ relFile: file, canonicalPath, keyPrefix: scope }];
}

function findSettingsPlaceholders({ messagesDir, locales, scopes }) {
  const root = messagesDir || path.join(process.cwd(), "messages");
  const targets = normalizeLocales(locales);
  const scopeList = normalizeScopes(scopes);

  const rows = [];
  for (const locale of targets) {
    for (const scope of scopeList) {
      const files = listCanonicalFilesForScope(root, scope);
      for (const f of files) {
        const tPath =
          scope === "settings"
            ? path.join(root, locale, "settings", f.relFile)
            : path.join(root, locale, f.relFile);
        if (!fs.existsSync(tPath)) continue;

        const cnObj = loadJson(f.canonicalPath);
        const tObj = loadJson(tPath);
        const cnFlat = flatten(cnObj);
        const tFlat = flatten(tObj);

        for (const [leafKey, cnVal] of Object.entries(cnFlat)) {
          const tVal = tFlat[leafKey];
          if (typeof cnVal !== "string" || typeof tVal !== "string") continue;
          if (!hasHanChars(cnVal)) continue;
          if (tVal !== cnVal) continue;

          const fullKey = f.keyPrefix
            ? leafKey
              ? `${f.keyPrefix}.${leafKey}`
              : f.keyPrefix
            : leafKey;

          rows.push({
            locale,
            relFile: f.relFile,
            key: fullKey,
            value: tVal,
            reason: "same_as_zh-CN",
          });
        }
      }
    }
  }

  return { rows, byLocaleCount: rows.reduce((acc, r) => ((acc[r.locale] = (acc[r.locale] || 0) + 1), acc), {}) };
}

function run(argv) {
  const fail = argv.includes("--fail");
  const messagesDirArg = argv.find((a) => a.startsWith("--messagesDir="));
  const messagesDir = messagesDirArg ? messagesDirArg.split("=", 2)[1] : undefined;
  const localesArg = argv.find((a) => a.startsWith("--locales="));
  const locales = localesArg ? localesArg.split("=", 2)[1] : undefined;
  const scopeArg = argv.find((a) => a.startsWith("--scope="));
  const scopes = scopeArg ? scopeArg.split("=", 2)[1] : undefined;
  const formatArg = argv.find((a) => a.startsWith("--format="));
  const format = formatArg ? formatArg.split("=", 2)[1] : "text";

  const report = findSettingsPlaceholders({ messagesDir, locales, scopes });
  const total = report.rows.length;

  if (total === 0) {
    return {
      exitCode: 0,
      lines: ["OK: no zh-CN placeholder candidates found in split settings."],
    };
  }

  if (format === "json") {
    return {
      exitCode: fail ? 1 : 0,
      lines: [JSON.stringify(report.rows, null, 2)],
    };
  }

  if (format === "tsv") {
    const lines = ["locale\trelFile\tkey\tvalue\treason"];
    for (const r of report.rows) {
      lines.push(`${r.locale}\t${r.relFile}\t${r.key}\t${r.value}\t${r.reason}`);
    }
    return { exitCode: fail ? 1 : 0, lines };
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
