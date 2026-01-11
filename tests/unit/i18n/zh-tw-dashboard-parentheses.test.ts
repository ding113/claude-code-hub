import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("messages/zh-TW/dashboard.json", () => {
  test("uses only fullwidth parentheses （） and avoids placeholder markers", () => {
    const filePath = path.join(process.cwd(), "messages", "zh-TW", "dashboard.json");
    const text = fs.readFileSync(filePath, "utf8");

    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).not.toMatch(/[()]/);

    const bannedMarkers = ["（繁）", "[JA]", "(TW)", "(繁)", "（TW）"];
    for (const marker of bannedMarkers) {
      expect(text).not.toContain(marker);
    }
  });
});
