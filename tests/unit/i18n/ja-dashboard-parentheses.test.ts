import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("messages/ja/dashboard.json", () => {
  test("uses only halfwidth parentheses () and avoids placeholder markers", () => {
    const filePath = path.join(process.cwd(), "messages", "ja", "dashboard.json");
    const text = fs.readFileSync(filePath, "utf8");

    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).not.toMatch(/[（）]/);

    const bannedMarkers = ["（繁）", "[JA]", "(TW)", "(繁)", "（TW）"];
    for (const marker of bannedMarkers) {
      expect(text).not.toContain(marker);
    }
  });
});
