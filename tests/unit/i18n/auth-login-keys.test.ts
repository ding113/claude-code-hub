import { describe, expect, it } from "vitest";

import enAuth from "../../../messages/en/auth.json";
import jaAuth from "../../../messages/ja/auth.json";
import ruAuth from "../../../messages/ru/auth.json";
import zhCNAuth from "../../../messages/zh-CN/auth.json";
import zhTWAuth from "../../../messages/zh-TW/auth.json";

/**
 * Recursively extract all dot-separated key paths from a nested object.
 * e.g. { a: { b: 1, c: 2 } } -> ["a.b", "a.c"]
 */
function extractKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...extractKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys.sort();
}

const locales: Record<string, Record<string, unknown>> = {
  en: enAuth,
  "zh-CN": zhCNAuth,
  "zh-TW": zhTWAuth,
  ja: jaAuth,
  ru: ruAuth,
};

const baselineKeys = extractKeys(locales.en);

describe("auth.json locale key parity", () => {
  it("English baseline has expected top-level sections", () => {
    const topLevel = Object.keys(enAuth).sort();
    expect(topLevel).toEqual(
      ["actions", "brand", "errors", "form", "login", "logout", "placeholders", "security"].sort()
    );
  });

  for (const [locale, data] of Object.entries(locales)) {
    if (locale === "en") continue;

    it(`${locale} has all keys present in English baseline`, () => {
      const localeKeys = extractKeys(data);
      const missing = baselineKeys.filter((k) => !localeKeys.includes(k));
      expect(missing, `${locale} is missing keys: ${missing.join(", ")}`).toEqual([]);
    });

    it(`${locale} has no extra keys beyond English baseline`, () => {
      const localeKeys = extractKeys(data);
      const extra = localeKeys.filter((k) => !baselineKeys.includes(k));
      expect(extra, `${locale} has extra keys: ${extra.join(", ")}`).toEqual([]);
    });
  }

  it("all 5 locales have identical key sets", () => {
    for (const [locale, data] of Object.entries(locales)) {
      const localeKeys = extractKeys(data);
      expect(localeKeys, `${locale} key mismatch`).toEqual(baselineKeys);
    }
  });
});
