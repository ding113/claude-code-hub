import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const readJson = (relPath: string) => {
  const filePath = path.join(process.cwd(), relPath);
  const text = fs.readFileSync(filePath, "utf8");
  return JSON.parse(text) as Record<string, string>;
};

describe("messages/ja/settings/providers/form/strings.json", () => {
  test("does not contain placeholder markers and uses halfwidth parentheses", () => {
    const ja = readJson("messages/ja/settings/providers/form/strings.json");

    for (const value of Object.values(ja)) {
      expect(value).not.toContain("[JA]");
      expect(value).not.toContain("（");
      expect(value).not.toContain("）");
      expect(value).not.toContain("（繁）");
      expect(value).not.toContain("(TW)");
      expect(value).not.toContain("（TW）");
    }
  });

  test("does not keep raw English strings (except safe placeholders)", () => {
    const ja = readJson("messages/ja/settings/providers/form/strings.json");
    const en = readJson("messages/en/settings/providers/form/strings.json");

    const allowedSameAsEn = [
      "costMultiplierPlaceholder",
      "failureThresholdPlaceholder",
      "openDurationPlaceholder",
      "priorityPlaceholder",
      "proxyTestResultMessage",
      "successThresholdPlaceholder",
      "websiteUrlPlaceholder",
      "weightPlaceholder",
    ].sort();

    const sameAsEn = Object.keys(en)
      .filter((key) => ja[key] === en[key])
      .sort();

    expect(sameAsEn).toEqual(allowedSameAsEn);
  });
});
