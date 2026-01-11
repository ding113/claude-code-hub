import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const readJson = (relPath: string) => {
  const filePath = path.join(process.cwd(), relPath);
  const text = fs.readFileSync(filePath, "utf8");
  return JSON.parse(text) as Record<string, string>;
};

const hasKana = /[ぁ-んァ-ン]/;

describe("messages/ja/settings/providers/strings.json", () => {
  test("does not contain placeholder markers or fullwidth parentheses", () => {
    const ja = readJson("messages/ja/settings/providers/strings.json");

    for (const value of Object.values(ja)) {
      expect(value).not.toContain("[JA]");
      expect(value).not.toContain("（繁）");
      expect(value).not.toContain("(TW)");
      expect(value).not.toContain("（TW）");

      expect(value).not.toContain("（");
      expect(value).not.toContain("）");
    }
  });

  test("key UI strings are translated to Japanese", () => {
    const ja = readJson("messages/ja/settings/providers/strings.json");

    const keys = [
      "keyLoading",
      "noProviders",
      "noProvidersDesc",
      "official",
      "resetCircuit",
      "resetCircuitDesc",
      "resetCircuitFailed",
      "searchNoResults",
      "searchResults",
      "todayUsage",
      "toggleFailed",
      "toggleSuccess",
      "toggleSuccessDesc",
      "updateFailed",
      "viewKey",
      "viewKeyDesc",
    ] as const;

    for (const key of keys) {
      expect(ja[key]).toMatch(hasKana);
    }
  });
});
