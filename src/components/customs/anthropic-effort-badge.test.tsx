import { describe, expect, test } from "vitest";
import { getAnthropicEffortBadgeClassName } from "./anthropic-effort-badge";

describe("getAnthropicEffortBadgeClassName", () => {
  test("uses a flat neutral style for auto", () => {
    const className = getAnthropicEffortBadgeClassName("auto");

    expect(className).toContain("bg-slate-50");
    expect(className).not.toContain("bg-gradient-to-r");
  });

  test("uses the cool-toned reasoning scale for higher efforts", () => {
    expect(getAnthropicEffortBadgeClassName("high")).toContain("bg-indigo-50");
    expect(getAnthropicEffortBadgeClassName("xhigh")).toContain("bg-violet-50");
    expect(getAnthropicEffortBadgeClassName("max")).toContain("bg-fuchsia-50");
  });

  test("normalizes whitespace and case before resolving the style", () => {
    expect(getAnthropicEffortBadgeClassName(" XHIGH ")).toContain("bg-violet-50");
  });

  test("falls back to muted styling for unknown effort values", () => {
    expect(getAnthropicEffortBadgeClassName("custom")).toContain("bg-muted/40");
  });
});
