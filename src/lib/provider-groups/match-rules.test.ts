import { describe, expect, it } from "vitest";
import {
  classifySiteGroupTagWithGroups,
  matchesProviderGroupRule,
  normalizeProviderGroupMatchRules,
} from "./match-rules";

describe("normalizeProviderGroupMatchRules", () => {
  it("keeps valid rules and drops empty", () => {
    expect(
      normalizeProviderGroupMatchRules([
        { matchType: "contains", pattern: "  claude " },
        { matchType: "exact", pattern: "" },
        { matchType: "nope", pattern: "x" },
      ])
    ).toEqual([{ matchType: "contains", pattern: "claude" }]);
  });
});

describe("matchesProviderGroupRule", () => {
  it("matches contains case-insensitively", () => {
    expect(
      matchesProviderGroupRule("Claude Kiro", { matchType: "contains", pattern: "claude" })
    ).toBe(true);
    expect(matchesProviderGroupRule("福利分组", { matchType: "contains", pattern: "福利" })).toBe(
      true
    );
  });

  it("matches prefix/exact", () => {
    expect(
      matchesProviderGroupRule("codex-Plus", { matchType: "prefix", pattern: "codex" })
    ).toBe(true);
    expect(matchesProviderGroupRule("Grok", { matchType: "exact", pattern: "grok" })).toBe(true);
  });
});

describe("classifySiteGroupTagWithGroups", () => {
  it("uses sort order: first matching group wins", () => {
    const groups = [
      {
        name: "codex",
        sortOrder: 10,
        matchRules: [{ matchType: "contains" as const, pattern: "福利" }],
      },
      {
        name: "claude",
        sortOrder: 20,
        matchRules: [{ matchType: "contains" as const, pattern: "claude" }],
      },
    ];
    expect(classifySiteGroupTagWithGroups("福利Claude", groups)).toBe("codex");
    expect(classifySiteGroupTagWithGroups("Claude Kiro", groups)).toBe("claude");
  });

  it("returns other when rules miss or empty", () => {
    const groups = [
      {
        name: "image",
        sortOrder: 1,
        matchRules: [{ matchType: "contains" as const, pattern: "image" }],
      },
    ];
    expect(classifySiteGroupTagWithGroups("random-group", groups)).toBe("other");
    expect(
      classifySiteGroupTagWithGroups("Claude Kiro", [{ name: "claude", sortOrder: 1 }])
    ).toBe("other");
  });
});
