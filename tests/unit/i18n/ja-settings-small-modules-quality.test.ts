import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const readJson = (relPath: string) => {
  const filePath = path.join(process.cwd(), relPath);
  const text = fs.readFileSync(filePath, "utf8");
  return JSON.parse(text) as unknown;
};

const flattenStrings = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(flattenStrings);
  return Object.values(value).flatMap(flattenStrings);
};

describe("ja settings small modules", () => {
  test("do not contain placeholder markers, emoji, or fullwidth parentheses", () => {
    const files = [
      "messages/ja/settings/common.json",
      "messages/ja/settings/requestFilters.json",
      "messages/ja/settings/prices.json",
    ] as const;

    for (const file of files) {
      const data = readJson(file);
      for (const text of flattenStrings(data)) {
        expect(text, file).not.toContain("（繁）");
        expect(text, file).not.toContain("[JA]");
        expect(text, file).not.toContain("(TW)");
        expect(text, file).not.toContain("(繁)");
        expect(text, file).not.toContain("（TW）");

        // Non zh/zh-TW should use halfwidth parentheses only
        expect(text, file).not.toContain("（");
        expect(text, file).not.toContain("）");

        expect(text, file).not.toMatch(/[1-4]\uFE0F\u20E3/);
      }
    }
  });
});
