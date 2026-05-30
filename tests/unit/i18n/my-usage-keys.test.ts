import { describe, expect, it } from "vitest";

import enMyUsage from "../../../messages/en/myUsage.json";
import jaMyUsage from "../../../messages/ja/myUsage.json";
import ruMyUsage from "../../../messages/ru/myUsage.json";
import zhCNMyUsage from "../../../messages/zh-CN/myUsage.json";
import zhTWMyUsage from "../../../messages/zh-TW/myUsage.json";

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
  en: enMyUsage,
  "zh-CN": zhCNMyUsage,
  "zh-TW": zhTWMyUsage,
  ja: jaMyUsage,
  ru: ruMyUsage,
};

const baselineKeys = extractKeys(enMyUsage);

describe("myUsage.json locale key parity", () => {
  for (const [locale, data] of Object.entries(locales)) {
    it(`${locale} matches the English key set`, () => {
      expect(extractKeys(data), `${locale} key mismatch`).toEqual(baselineKeys);
    });
  }

  it("defines a documentation label for the readonly usage header", () => {
    for (const [locale, data] of Object.entries(locales)) {
      const documentation = data.header?.documentation;
      expect(typeof documentation, `${locale} header.documentation`).toBe("string");
      expect((documentation as string).trim(), `${locale} header.documentation`).not.toBe("");
    }
  });
});
