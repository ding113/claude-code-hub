import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const LOCALES = ["zh-CN", "zh-TW", "en", "ja", "ru"] as const;
const CANONICAL: (typeof LOCALES)[number] = "zh-CN";

const SETTINGS_LINE_THRESHOLD = 800;

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function typeTag(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function listJsonFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".json")) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

function loadJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadSplitSettings(locale: (typeof LOCALES)[number]): Record<string, unknown> {
  const settingsDir = path.join(process.cwd(), "messages", locale, "settings");
  const out: Record<string, unknown> = {};

  for (const entry of fs.readdirSync(settingsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const name = entry.name.replace(/\.json$/, "");
    const v = loadJson(path.join(settingsDir, entry.name)) as Record<string, unknown>;
    if (name === "strings") Object.assign(out, v);
    else out[name] = v;
  }

  const providersDir = path.join(settingsDir, "providers");
  const providers: Record<string, unknown> = {};
  for (const entry of fs.readdirSync(providersDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const name = entry.name.replace(/\.json$/, "");
    const v = loadJson(path.join(providersDir, entry.name)) as Record<string, unknown>;
    if (name === "strings") Object.assign(providers, v);
    else providers[name] = v;
  }

  const formDir = path.join(providersDir, "form");
  const form: Record<string, unknown> = {};
  for (const entry of fs.readdirSync(formDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const name = entry.name.replace(/\.json$/, "");
    const v = loadJson(path.join(formDir, entry.name)) as Record<string, unknown>;
    if (name === "strings") Object.assign(form, v);
    else form[name] = v;
  }
  providers.form = form;
  out.providers = providers;

  return out;
}

function flattenLeafTypes(
  obj: unknown,
  prefix = "",
  out: Record<string, string> = {}
): Record<string, string> {
  if (!isObject(obj)) {
    if (prefix) out[prefix] = typeTag(obj);
    return out;
  }

  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isObject(v)) flattenLeafTypes(v, key, out);
    else out[key] = typeTag(v);
  }
  return out;
}

describe("i18n settings split guards", () => {
  test("split file layout matches canonical and each file <= 800 lines", () => {
    const canonicalDir = path.join(process.cwd(), "messages", CANONICAL, "settings");
    const canonicalFiles = listJsonFilesRecursive(canonicalDir).map((p) =>
      path.relative(canonicalDir, p).replaceAll(path.sep, "/")
    );

    for (const locale of LOCALES) {
      const dir = path.join(process.cwd(), "messages", locale, "settings");
      const files = listJsonFilesRecursive(dir).map((p) =>
        path.relative(dir, p).replaceAll(path.sep, "/")
      );
      expect(files).toEqual(canonicalFiles);

      for (const file of listJsonFilesRecursive(dir)) {
        const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).length;
        expect(lines).toBeLessThanOrEqual(SETTINGS_LINE_THRESHOLD);
      }
    }
  });

  test("settings key set and leaf types match canonical (zh-CN)", () => {
    const canonical = loadSplitSettings(CANONICAL);
    const canonicalLeaves = flattenLeafTypes(canonical);
    const canonicalKeys = Object.keys(canonicalLeaves).sort();

    for (const locale of LOCALES) {
      const settings = loadSplitSettings(locale);
      const leaves = flattenLeafTypes(settings);
      const keys = Object.keys(leaves).sort();
      expect(keys).toEqual(canonicalKeys);

      for (const k of canonicalKeys) {
        expect(leaves[k]).toBe(canonicalLeaves[k]);
      }
    }
  });
});
