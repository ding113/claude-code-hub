import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const readJson = (relPath: string) => {
  const filePath = path.join(process.cwd(), relPath);
  const text = fs.readFileSync(filePath, "utf8");
  return JSON.parse(text) as Record<string, string>;
};

describe("messages/zh-TW/settings/providers/strings.json", () => {
  test("does not contain placeholder markers, emoji, or halfwidth parentheses", () => {
    const zhTW = readJson("messages/zh-TW/settings/providers/strings.json");

    for (const value of Object.values(zhTW)) {
      expect(value).not.toContain("（繁）");
      expect(value).not.toContain("[JA]");
      expect(value).not.toContain("(TW)");
      expect(value).not.toContain("(繁)");
      expect(value).not.toContain("（TW）");

      // zh/zh-TW should use fullwidth parentheses only
      expect(value).not.toContain("(");
      expect(value).not.toContain(")");

      expect(value).not.toMatch(/[1-4]\uFE0F\u20E3/);
    }
  });
});
