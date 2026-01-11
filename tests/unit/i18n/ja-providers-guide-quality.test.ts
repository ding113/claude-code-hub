import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const readJson = (relPath: string) => {
  const filePath = path.join(process.cwd(), relPath);
  const text = fs.readFileSync(filePath, "utf8");
  return JSON.parse(text) as Record<string, string>;
};

describe("messages/ja/settings/providers/guide.json", () => {
  test("does not contain placeholder markers, emoji, or fullwidth parentheses", () => {
    const ja = readJson("messages/ja/settings/providers/guide.json");

    for (const value of Object.values(ja)) {
      expect(value).not.toContain("[JA]");
      expect(value).not.toContain("（繁）");
      expect(value).not.toContain("(TW)");
      expect(value).not.toContain("（TW）");

      expect(value).not.toContain("（");
      expect(value).not.toContain("）");

      expect(value).not.toMatch(/[1-4]\uFE0F\u20E3/);
    }
  });

  test("does not keep raw English guide strings", () => {
    const ja = readJson("messages/ja/settings/providers/guide.json");
    const en = readJson("messages/en/settings/providers/guide.json");

    const sameAsEn = Object.keys(en)
      .filter((key) => ja[key] === en[key])
      .sort();

    expect(sameAsEn).toEqual([]);
  });
});
