import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const readJson = (relPath: string) => {
  const filePath = path.join(process.cwd(), relPath);
  const text = fs.readFileSync(filePath, "utf8");
  return JSON.parse(text) as unknown;
};

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

function visitStrings(value: JsonValue, visit: (text: string) => void): void {
  if (typeof value === "string") {
    visit(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      visitStrings(item, visit);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      visitStrings(item, visit);
    }
  }
}

describe("messages/zh-TW/settings/providers/strings.json", () => {
  test("does not contain placeholder markers, emoji, or halfwidth parentheses", () => {
    const zhTW = readJson("messages/zh-TW/settings/providers/strings.json") as JsonValue;

    visitStrings(zhTW, (value) => {
      expect(value).not.toContain("（繁）");
      expect(value).not.toContain("[JA]");
      expect(value).not.toContain("(TW)");
      expect(value).not.toContain("(繁)");
      expect(value).not.toContain("（TW）");

      // zh/zh-TW should use fullwidth parentheses only
      expect(value).not.toContain("(");
      expect(value).not.toContain(")");

      expect(value).not.toMatch(/[1-4]\uFE0F\u20E3/);
    });
  });
});
