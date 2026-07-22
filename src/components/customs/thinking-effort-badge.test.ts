import { describe, expect, test } from "vitest";
import { getThinkingEffortBadgeClassName } from "./thinking-effort-badge";

describe("getThinkingEffortBadgeClassName", () => {
  test("Codex minimal 使用低强度样式", () => {
    expect(getThinkingEffortBadgeClassName(" minimal ")).toContain("stone");
  });

  test("Codex none 使用关闭状态样式", () => {
    expect(getThinkingEffortBadgeClassName("NONE")).toContain("zinc");
  });

  test("Codex max 使用最高强度样式", () => {
    expect(getThinkingEffortBadgeClassName("max")).toContain("red-300");
  });

  test("未知强度使用中性兜底样式", () => {
    expect(getThinkingEffortBadgeClassName("future-level")).toContain("muted-foreground");
  });
});
