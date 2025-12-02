/*
 * Synchronize keys of settings.json across locales using zh-CN as canonical.
 * - Ensures every locale has exactly the same set of nested keys
 * - Keeps existing translations where keys exist
 * - Fills missing keys with zh-CN text as placeholder
 * - Drops extra keys not present in zh-CN (notably for en, but applies consistently)
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const MESSAGES_DIR = path.join(ROOT, "messages");
const LOCALES = ["en", "ja", "ru", "zh-TW"];
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

function mergeWithCanonical(cn, target) {
  const result = Array.isArray(cn) ? [] : {};
  for (const [k, v] of Object.entries(cn)) {
    const tVal = target?.[k];
    if (isObject(v)) {
      // Canonical expects an object; only descend if target also has an object, else ignore target
      const tchild = isObject(tVal) ? tVal : {};
      result[k] = mergeWithCanonical(v, tchild);
    } else {
      // Canonical expects a leaf (string/number/bool/array/null). If target is an object, ignore it.
      if (Object.hasOwn(target || {}, k) && !isObject(tVal)) {
        result[k] = tVal;
      } else {
        result[k] = v;
      }
    }
  }
  return result;
}

function sortKeysDeep(obj) {
  if (!isObject(obj)) return obj;
  const out = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortKeysDeep(obj[key]);
  }
  return out;
}

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveJSON(p, data) {
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function ensureSettings(locale) {
  const cnPath = path.join(MESSAGES_DIR, CANONICAL, "settings.json");
  const targetPath = path.join(MESSAGES_DIR, locale, "settings.json");

  const cn = loadJSON(cnPath);
  const t = loadJSON(targetPath);

  const merged = mergeWithCanonical(cn, t);
  // Drop extras implicitly by not copying unknown keys; merged contains only canonical keys
  const sorted = sortKeysDeep(merged);

  // Stats
  const cnKeys = Object.keys(flatten(cn));
  const tKeys = Object.keys(flatten(t));
  const mergedKeys = Object.keys(flatten(sorted));

  const missingBefore = cnKeys.filter((k) => !tKeys.includes(k));
  const extraBefore = tKeys.filter((k) => !cnKeys.includes(k));
  const missingAfter = cnKeys.filter((k) => !mergedKeys.includes(k));
  const extraAfter = mergedKeys.filter((k) => !cnKeys.includes(k));

  saveJSON(targetPath, sorted);

  return {
    locale,
    targetPath,
    cnCount: cnKeys.length,
    before: { count: tKeys.length, missing: missingBefore.length, extra: extraBefore.length },
    after: { count: mergedKeys.length, missing: missingAfter.length, extra: extraAfter.length },
  };
}

function main() {
  const reports = [];
  for (const loc of LOCALES) {
    const p = path.join(MESSAGES_DIR, loc, "settings.json");
    if (!fs.existsSync(p)) {
      console.error(`[skip] ${loc} has no settings.json`);
      continue;
    }
    reports.push(ensureSettings(loc));
  }

  // Print summary
  for (const r of reports) {
    console.log(
      `${r.locale}: cn=${r.cnCount}, before=${r.before.count} (-${r.before.missing} missing, +${r.before.extra} extra), after=${r.after.count} (-${r.after.missing} missing, +${r.after.extra} extra)`
    );
  }
}

if (require.main === module) {
  main();
}
