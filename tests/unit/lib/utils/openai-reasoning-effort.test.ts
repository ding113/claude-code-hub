import { describe, expect, test } from "vitest";
import {
  extractOpenAIReasoningEffortFromRequestBody,
  extractOpenAIReasoningEffortFromSpecialSettings,
} from "@/lib/utils/openai-reasoning-effort";
import type { SpecialSetting } from "@/types/special-settings";

describe("extractOpenAIReasoningEffortFromRequestBody", () => {
  test("优先读取顶层 reasoning_effort", () => {
    const result = extractOpenAIReasoningEffortFromRequestBody({
      model: "gpt-5.5",
      messages: [],
      reasoning_effort: "high",
    });

    expect(result).toEqual({ effort: "high", source: "reasoning_effort" });
  });

  test("顶层缺失时兜底读取嵌套 reasoning.effort", () => {
    const result = extractOpenAIReasoningEffortFromRequestBody({
      model: "gpt-5.5",
      messages: [],
      reasoning: { effort: "low" },
    });

    expect(result).toEqual({ effort: "low", source: "reasoning.effort" });
  });

  test("顶层与嵌套不一致时以顶层为准", () => {
    const result = extractOpenAIReasoningEffortFromRequestBody({
      reasoning_effort: "max",
      reasoning: { effort: "minimal" },
    });

    expect(result).toEqual({ effort: "max", source: "reasoning_effort" });
  });

  test("顶层与嵌套一致时读取顶层", () => {
    const result = extractOpenAIReasoningEffortFromRequestBody({
      reasoning_effort: "medium",
      reasoning: { effort: "medium" },
    });

    expect(result).toEqual({ effort: "medium", source: "reasoning_effort" });
  });

  test("顶层为空白时回退嵌套值", () => {
    const result = extractOpenAIReasoningEffortFromRequestBody({
      reasoning_effort: "  ",
      reasoning: { effort: "xhigh" },
    });

    expect(result).toEqual({ effort: "xhigh", source: "reasoning.effort" });
  });

  test("顶层为非法类型时回退嵌套值", () => {
    const result = extractOpenAIReasoningEffortFromRequestBody({
      reasoning_effort: 42,
      reasoning: { effort: "high" },
    });

    expect(result).toEqual({ effort: "high", source: "reasoning.effort" });
  });

  test("两者均缺失时返回 null", () => {
    expect(
      extractOpenAIReasoningEffortFromRequestBody({ model: "gpt-5.5", messages: [] })
    ).toBeNull();
  });

  test("reasoning 非对象时返回 null", () => {
    expect(extractOpenAIReasoningEffortFromRequestBody({ reasoning: "not-an-object" })).toBeNull();
  });

  test("非对象请求体返回 null", () => {
    expect(extractOpenAIReasoningEffortFromRequestBody(null)).toBeNull();
    expect(extractOpenAIReasoningEffortFromRequestBody("string")).toBeNull();
    expect(extractOpenAIReasoningEffortFromRequestBody([1, 2])).toBeNull();
  });

  test("保留实际取值域（不做白名单过滤）", () => {
    const result = extractOpenAIReasoningEffortFromRequestBody({ reasoning_effort: "max" });

    expect(result?.effort).toBe("max");
  });
});

describe("extractOpenAIReasoningEffortFromSpecialSettings", () => {
  test("读取首个有效的 openai 思考强度审计", () => {
    const settings: SpecialSetting[] = [
      {
        type: "openai_reasoning_effort",
        scope: "request",
        hit: true,
        effort: "high",
        source: "reasoning_effort",
      },
    ];

    expect(extractOpenAIReasoningEffortFromSpecialSettings(settings)).toEqual({
      effort: "high",
      source: "reasoning_effort",
    });
  });

  test("忽略其它类型审计", () => {
    const settings: SpecialSetting[] = [
      {
        type: "codex_reasoning_effort",
        scope: "request",
        hit: true,
        effort: "high",
      },
    ];

    expect(extractOpenAIReasoningEffortFromSpecialSettings(settings)).toBeNull();
  });

  test("缺少审计数组时返回 null", () => {
    expect(extractOpenAIReasoningEffortFromSpecialSettings(undefined)).toBeNull();
    expect(extractOpenAIReasoningEffortFromSpecialSettings(null)).toBeNull();
    expect(extractOpenAIReasoningEffortFromSpecialSettings([])).toBeNull();
  });
});
