import fs from "node:fs";
import path from "node:path";

type JsonValue = unknown;

function readJson(filePath: string): JsonValue {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonValue;
}

function loadSplitSettings(settingsDir: string): Record<string, JsonValue> {
  const top: Record<string, JsonValue> = {};

  for (const entry of fs.readdirSync(settingsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const name = entry.name.replace(/\.json$/, "");
    const value = readJson(path.join(settingsDir, entry.name));
    if (name === "strings" && value && typeof value === "object") {
      Object.assign(top, value);
      continue;
    }
    top[name] = value;
  }

  const providersDir = path.join(settingsDir, "providers");
  const providers: Record<string, JsonValue> = {};
  if (fs.existsSync(providersDir)) {
    for (const entry of fs.readdirSync(providersDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const name = entry.name.replace(/\.json$/, "");
      const value = readJson(path.join(providersDir, entry.name));
      if (name === "strings" && value && typeof value === "object") {
        Object.assign(providers, value);
        continue;
      }
      providers[name] = value;
    }

    const formDir = path.join(providersDir, "form");
    const form: Record<string, JsonValue> = {};
    if (fs.existsSync(formDir)) {
      for (const entry of fs.readdirSync(formDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const name = entry.name.replace(/\.json$/, "");
        const value = readJson(path.join(formDir, entry.name));
        if (name === "strings" && value && typeof value === "object") {
          Object.assign(form, value);
          continue;
        }
        form[name] = value;
      }
    }

    providers.form = form;
  }

  top.providers = providers;
  return top;
}

function loadSettingsMessages(base: string): JsonValue {
  const legacy = path.join(base, "settings.json");
  if (fs.existsSync(legacy)) return readJson(legacy);

  const splitDir = path.join(base, "settings");
  return loadSplitSettings(splitDir);
}

export function loadMessages(locale: string = "en") {
  const base = path.join(process.cwd(), "messages", locale);
  const read = (name: string) => readJson(path.join(base, name));

  return {
    common: read("common.json"),
    errors: read("errors.json"),
    ui: read("ui.json"),
    forms: read("forms.json"),
    settings: loadSettingsMessages(base),
  };
}
