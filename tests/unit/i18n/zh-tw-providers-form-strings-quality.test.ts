import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const readJson = (relPath: string) => {
  const filePath = path.join(process.cwd(), relPath);
  const text = fs.readFileSync(filePath, "utf8");
  return JSON.parse(text) as Record<string, string>;
};

describe("messages/zh-TW/settings/providers/form/strings.json", () => {
  test("does not contain placeholder markers and uses fullwidth parentheses", () => {
    const zhTW = readJson("messages/zh-TW/settings/providers/form/strings.json");

    for (const value of Object.values(zhTW)) {
      expect(value).not.toContain("（繁）");
      expect(value).not.toContain("[JA]");
      expect(value).not.toContain("(TW)");
      expect(value).not.toContain("(繁)");
      expect(value).not.toContain("（TW）");

      // zh/zh-TW should use fullwidth parentheses only
      expect(value).not.toContain("(");
      expect(value).not.toContain(")");
    }
  });
});
