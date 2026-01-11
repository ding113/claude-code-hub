import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const readJson = (relPath: string) => {
  const filePath = path.join(process.cwd(), relPath);
  const text = fs.readFileSync(filePath, "utf8");
  return JSON.parse(text) as Record<string, unknown>;
};

const flatten = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(flatten);
  return Object.values(value).flatMap(flatten);
};

describe("messages/zh-TW/settings/providers/form/apiTest.json", () => {
  test("does not contain placeholder markers, emoji, or halfwidth parentheses", () => {
    const zhTW = readJson("messages/zh-TW/settings/providers/form/apiTest.json");

    for (const text of flatten(zhTW)) {
      expect(text).not.toContain("（繁）");
      expect(text).not.toContain("[JA]");
      expect(text).not.toContain("(TW)");
      expect(text).not.toContain("(繁)");
      expect(text).not.toContain("（TW）");

      // zh/zh-TW should use fullwidth parentheses only
      expect(text).not.toContain("(");
      expect(text).not.toContain(")");

      expect(text).not.toMatch(/[1-4]\uFE0F\u20E3/);
    }
  });
});
