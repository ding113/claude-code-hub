import { describe, expect, it } from "vitest";
import {
  matchesProviderGroupModelMatchRules,
  normalizeProviderGroupModelMatchRules,
} from "./model-match-rules";

describe("provider group model match rules", () => {
  it("normalizes empty rules to no restriction", () => {
    expect(normalizeProviderGroupModelMatchRules(null)).toBeNull();
    expect(normalizeProviderGroupModelMatchRules([])).toBeNull();
    expect(
      normalizeProviderGroupModelMatchRules([
        { matchType: "prefix", pattern: "  gpt- " },
        { matchType: "exact", pattern: "" },
      ])
    ).toEqual([{ matchType: "prefix", pattern: "gpt-" }]);
  });

  it("allows every model when no group has model rules", () => {
    expect(matchesProviderGroupModelMatchRules("any-model", ["codex"], new Map())).toBe(true);
  });

  it("requires a configured group rule to match", () => {
    const rules = new Map([["codex", [{ matchType: "prefix" as const, pattern: "gpt-" }]]]);

    expect(matchesProviderGroupModelMatchRules("gpt-4o", ["codex"], rules)).toBe(true);
    expect(matchesProviderGroupModelMatchRules("claude-3", ["codex"], rules)).toBe(false);
  });

  it("allows a multi-group provider when any configured group matches", () => {
    const rules = new Map([
      ["claude", [{ matchType: "contains" as const, pattern: "claude" }]],
      ["codex", [{ matchType: "prefix" as const, pattern: "gpt-" }]],
    ]);

    expect(matchesProviderGroupModelMatchRules("claude-3-7", ["codex", "claude"], rules)).toBe(
      true
    );
    expect(matchesProviderGroupModelMatchRules("gemini-2", ["codex", "claude"], rules)).toBe(false);
  });
});
