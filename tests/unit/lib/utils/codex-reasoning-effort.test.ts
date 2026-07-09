import { describe, expect, test } from "vitest";
import {
  extractCodexReasoningEffortFromRequestBody,
  extractCodexReasoningEffortFromSpecialSettings,
  extractCodexReasoningEffortInfo,
} from "@/lib/utils/codex-reasoning-effort";
import type { SpecialSetting } from "@/types/special-settings";

describe("extractCodexReasoningEffortFromRequestBody", () => {
  test.each([
    [null, null],
    [[], null],
    [{}, null],
    [{ reasoning: [] }, null],
    [{ reasoning: { effort: 1 } }, null],
    [{ reasoning: { effort: "   " } }, null],
    [{ reasoning: { effort: " high " } }, "high"],
  ])("从 Codex 请求体提取 reasoning.effort: %#", (requestBody, expected) => {
    expect(extractCodexReasoningEffortFromRequestBody(requestBody)).toBe(expected);
  });
});

describe("extractCodexReasoningEffortFromSpecialSettings", () => {
  test("读取首个有效的 Codex 思考强度审计", () => {
    const settings: SpecialSetting[] = [
      { type: "codex_reasoning_effort", scope: "request", hit: true, effort: " " },
      { type: "codex_reasoning_effort", scope: "request", hit: true, effort: "medium" },
    ];

    expect(extractCodexReasoningEffortFromSpecialSettings(settings)).toBe("medium");
  });

  test("缺少审计数组时返回 null", () => {
    expect(extractCodexReasoningEffortFromSpecialSettings(undefined)).toBeNull();
  });
});

describe("extractCodexReasoningEffortInfo", () => {
  test("直接显示客户端请求的思考强度", () => {
    expect(
      extractCodexReasoningEffortInfo([
        { type: "codex_reasoning_effort", scope: "request", hit: true, effort: "high" },
      ])
    ).toEqual({
      requestedEffort: "high",
      effectiveEffort: "high",
      isOverridden: false,
    });
  });

  test("同时显示客户端请求值和 Codex 供应商覆写后的实际值", () => {
    expect(
      extractCodexReasoningEffortInfo([
        { type: "codex_reasoning_effort", scope: "request", hit: true, effort: "low" },
        {
          type: "provider_parameter_override",
          scope: "provider",
          providerId: 1,
          providerName: "Codex",
          providerType: "codex",
          hit: true,
          changed: true,
          changes: [{ path: "reasoning.effort", before: "low", after: "high", changed: true }],
        },
      ])
    ).toEqual({
      requestedEffort: "low",
      effectiveEffort: "high",
      isOverridden: true,
    });
  });

  test("供应商强制设置思考强度时显示实际转发值", () => {
    expect(
      extractCodexReasoningEffortInfo([
        {
          type: "provider_parameter_override",
          scope: "provider",
          providerId: 1,
          providerName: "Codex",
          providerType: "codex",
          hit: true,
          changed: true,
          changes: [{ path: "reasoning.effort", before: null, after: "medium", changed: true }],
        },
      ])
    ).toEqual({
      requestedEffort: null,
      effectiveEffort: "medium",
      isOverridden: true,
    });
  });

  test("兼容仅包含 Codex 覆写审计的历史记录", () => {
    expect(
      extractCodexReasoningEffortInfo([
        {
          type: "provider_parameter_override",
          scope: "provider",
          providerId: 1,
          providerName: "Codex",
          providerType: "codex",
          hit: true,
          changed: false,
          changes: [
            { path: "reasoning.effort", before: "minimal", after: "minimal", changed: false },
          ],
        },
      ])
    ).toEqual({
      requestedEffort: "minimal",
      effectiveEffort: "minimal",
      isOverridden: false,
    });
  });

  test("忽略非 Codex 供应商的同名覆写字段", () => {
    expect(
      extractCodexReasoningEffortInfo([
        {
          type: "provider_parameter_override",
          scope: "provider",
          providerId: 2,
          providerName: "Other",
          providerType: "openai-compatible",
          hit: true,
          changed: true,
          changes: [{ path: "reasoning.effort", before: "low", after: "high", changed: true }],
        },
      ])
    ).toBeNull();
  });

  test.each([null, undefined, []])("无思考强度审计时返回 null: %#", (settings) => {
    expect(extractCodexReasoningEffortInfo(settings)).toBeNull();
  });
});
