/*
 * Synchronize keys of settings messages across locales using zh-CN as canonical.
 *
 * Supports both layouts:
 * - legacy: messages/<locale>/settings.json
 * - split:  messages/<locale>/settings/ (recursive .json files, assembled by messages/<locale>/settings/index.ts)
 *
 * Behavior:
 * - Ensures every locale has exactly the same set of nested keys as canonical (zh-CN)
 * - Keeps existing translations where keys exist
 * - Fills missing keys with zh-CN text as placeholder
 * - Drops extra keys not present in zh-CN (applies consistently to all locales)
 */
const fs = require("node:fs");
const path = require("node:path");

const LOCALES = ["en", "ja", "ru", "zh-TW"];
const CANONICAL = "zh-CN";
const DEFAULT_MESSAGES_DIR = path.join(process.cwd(), "messages");

function getMessagesDir(messagesDir) {
  return messagesDir || DEFAULT_MESSAGES_DIR;
}

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

function getPath(obj, segments) {
  let cur = obj;
  for (const s of segments) {
    if (!isObject(cur) || !Object.hasOwn(cur, s)) return undefined;
    cur = cur[s];
  }
  return cur;
}

function loadSplitSettings(locale, messagesDir) {
  const settingsDir = path.join(getMessagesDir(messagesDir), locale, "settings");
  if (!fs.existsSync(settingsDir)) return null;

  const top = {};
  for (const file of fs.readdirSync(settingsDir, { withFileTypes: true })) {
    if (file.isDirectory()) continue;
    if (!file.name.endsWith(".json")) continue;
    const name = file.name.replace(/\.json$/, "");
    const v = loadJSON(path.join(settingsDir, file.name));
    if (name === "strings") Object.assign(top, v);
    else top[name] = v;
  }

  const providersDir = path.join(settingsDir, "providers");
  const providers = {};
  if (fs.existsSync(providersDir)) {
    for (const file of fs.readdirSync(providersDir, { withFileTypes: true })) {
      if (file.isDirectory()) continue;
      if (!file.name.endsWith(".json")) continue;
      const name = file.name.replace(/\.json$/, "");
      const v = loadJSON(path.join(providersDir, file.name));
      if (name === "strings") Object.assign(providers, v);
      else providers[name] = v;
    }

    const formDir = path.join(providersDir, "form");
    const form = {};
    if (fs.existsSync(formDir)) {
      for (const file of fs.readdirSync(formDir, { withFileTypes: true })) {
        if (file.isDirectory()) continue;
        if (!file.name.endsWith(".json")) continue;
        const name = file.name.replace(/\.json$/, "");
        const v = loadJSON(path.join(formDir, file.name));
        if (name === "strings") Object.assign(form, v);
        else form[name] = v;
      }
    }
    providers.form = form;
  }

  top.providers = providers;
  return top;
}

function saveSplitSettingsFromCanonical(locale, merged, messagesDir) {
  const root = getMessagesDir(messagesDir);
  const cnSettingsDir = path.join(root, CANONICAL, "settings");
  const targetSettingsDir = path.join(root, locale, "settings");

  const cnFiles = listJsonFiles(cnSettingsDir).map((p) => path.relative(cnSettingsDir, p));
  for (const rel of cnFiles) {
    const cnPath = path.join(cnSettingsDir, rel);
    const targetPath = path.join(targetSettingsDir, rel);
    const segs = rel.replace(/\.json$/, "").split(path.sep);

    // special: strings.json means "spread into parent object"
    if (segs[segs.length - 1] === "strings") {
      const tmpl = loadJSON(cnPath);
      const parentSegs = segs.slice(0, -1);
      const parent = parentSegs.length ? getPath(merged, parentSegs) : merged;
      const out = {};
      for (const k of Object.keys(tmpl)) out[k] = parent?.[k];
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      saveJSON(targetPath, sortKeysDeep(out));
      continue;
    }

    const v = getPath(merged, segs);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    saveJSON(targetPath, sortKeysDeep(v));
  }
}

function ensureSettings(locale, messagesDir) {
  const root = getMessagesDir(messagesDir);
  const cnSplit = loadSplitSettings(CANONICAL, root);
  const useSplit = Boolean(cnSplit);
  const cnPath = path.join(root, CANONICAL, "settings.json");
  const targetPath = path.join(root, locale, "settings.json");

  const cn = useSplit ? cnSplit : loadJSON(cnPath);
  const tSplit = loadSplitSettings(locale, root);
  const t = useSplit ? (tSplit ?? {}) : loadJSON(targetPath);

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

  if (useSplit) {
    saveSplitSettingsFromCanonical(locale, sorted, root);
  } else {
    saveJSON(targetPath, sorted);
  }

  return {
    locale,
    targetPath: useSplit ? path.join(root, locale, "settings") : targetPath,
    cnCount: cnKeys.length,
    before: { count: tKeys.length, missing: missingBefore.length, extra: extraBefore.length },
    after: { count: mergedKeys.length, missing: missingAfter.length, extra: extraAfter.length },
  };
}

function main() {
  const reports = [];
  for (const loc of LOCALES) {
    const legacy = path.join(DEFAULT_MESSAGES_DIR, loc, "settings.json");
    const split = path.join(DEFAULT_MESSAGES_DIR, loc, "settings");
    if (!fs.existsSync(legacy) && !fs.existsSync(split)) {
      console.error(`[skip] ${loc} has no settings messages`);
      continue;
    }
    reports.push(ensureSettings(loc, DEFAULT_MESSAGES_DIR));
  }

  // Print summary
  for (const r of reports) {
    console.log(
      `${r.locale}: cn=${r.cnCount}, before=${r.before.count} (-${r.before.missing} missing, +${r.before.extra} extra), after=${r.after.count} (-${r.after.missing} missing, +${r.after.extra} extra)`
    );
  }
}

module.exports = {
  ensureSettings,
  flatten,
  loadSplitSettings,
  mergeWithCanonical,
  sortKeysDeep,
};

if (require.main === module) {
  main();
}
