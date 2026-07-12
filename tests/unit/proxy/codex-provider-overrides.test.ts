import { describe, expect, it } from "vitest";
import {
  applyCodexProviderOverrides,
  applyCodexProviderOverridesWithAudit,
} from "@/lib/codex/provider-overrides";

describe("Codex 供应商级参数覆写", () => {
  it("当 providerType 不是 codex 时，应直接返回原对象且不做任何处理", () => {
    const provider = {
      providerType: "claude",
      codexReasoningEffortPreference: "high",
      codexParallelToolCallsPreference: "false",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      parallel_tool_calls: true,
      reasoning: { effort: "low", summary: "auto" },
    };

    const output = applyCodexProviderOverrides(provider as any, input);
    expect(output).toBe(input);
    expect(output).toEqual(input);
  });

  it("当所有偏好均为 inherit/null 时，应保持请求不变", () => {
    const provider = {
      providerType: "codex",
      codexReasoningEffortPreference: null,
      codexReasoningSummaryPreference: null,
      codexTextVerbosityPreference: null,
      codexParallelToolCallsPreference: null,
      codexImageGenerationPreference: null,
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      parallel_tool_calls: false,
      reasoning: { effort: "low", summary: "auto" },
      text: { verbosity: "medium" },
    };
    const snapshot = structuredClone(input);

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output).toEqual(snapshot);
    expect(input).toEqual(snapshot);
  });

  it("当偏好值为字符串 inherit 时，应视为不覆写", () => {
    const provider = {
      providerType: "codex",
      codexReasoningEffortPreference: "inherit",
      codexReasoningSummaryPreference: "inherit",
      codexTextVerbosityPreference: "inherit",
      codexParallelToolCallsPreference: "inherit",
      codexImageGenerationPreference: "inherit",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      parallel_tool_calls: false,
      reasoning: { effort: "low", summary: "auto" },
      text: { verbosity: "medium", other: "keep" },
    };
    const snapshot = structuredClone(input);

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output).toEqual(snapshot);
    expect(input).toEqual(snapshot);
  });

  it("当强制 parallel_tool_calls 时，应覆写为对应布尔值", () => {
    const provider = {
      providerType: "codex",
      codexParallelToolCallsPreference: "false",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      parallel_tool_calls: true,
    };

    const output = applyCodexProviderOverrides(provider as any, input);
    expect(output.parallel_tool_calls).toBe(false);
    expect(input.parallel_tool_calls).toBe(true);
  });

  it("当强制 image_generation=true 时，应自动注入图像生成工具且不重复追加", () => {
    const provider = {
      providerType: "codex",
      codexImageGenerationPreference: "true",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      tools: [{ type: "function", name: "lookup_weather" }],
      tool_choice: "none",
    };

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output.tools).toEqual([
      { type: "function", name: "lookup_weather" },
      { type: "image_generation" },
    ]);
    expect(output.tool_choice).toBe("none");
    expect(input.tools).toEqual([{ type: "function", name: "lookup_weather" }]);
  });

  it("当强制 image_generation=true 且请求缺少 tools 时，应自动创建图像生成工具数组", () => {
    const provider = {
      providerType: "codex",
      codexImageGenerationPreference: "true",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
    };

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output.tools).toEqual([{ type: "image_generation" }]);
    expect(input.tools).toBeUndefined();
  });

  it("当强制 image_generation=true 且 tool_choice=allowed_tools 时，应补齐白名单中的图像工具", () => {
    const provider = {
      providerType: "codex",
      codexImageGenerationPreference: "true",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      tools: [{ type: "function", name: "lookup_weather" }],
      tool_choice: {
        type: "allowed_tools",
        mode: "auto",
        tools: [{ type: "function", name: "lookup_weather" }],
      },
    };

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output.tools).toEqual([
      { type: "function", name: "lookup_weather" },
      { type: "image_generation" },
    ]);
    expect(output.tool_choice).toEqual({
      type: "allowed_tools",
      mode: "auto",
      tools: [{ type: "function", name: "lookup_weather" }, { type: "image_generation" }],
    });
  });

  it("当强制 image_generation=true 且请求已声明 image_gen namespace 时，不应重复注入图像工具", () => {
    const provider = {
      providerType: "codex",
      codexImageGenerationPreference: "true",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      tools: [
        {
          type: "namespace",
          name: "image_gen",
          tools: [{ type: "function", name: "imagegen" }],
        },
      ],
    };

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output).toBe(input);
    expect(output.tools).toEqual(input.tools);
  });

  it("当强制 image_generation=true 且 Responses Lite 已声明 image_gen namespace 时，不应重复注入顶层工具", () => {
    const provider = {
      providerType: "codex",
      codexImageGenerationPreference: "true",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [
        {
          type: "additional_tools",
          tools: [{ type: "namespace", name: "image_gen" }],
        },
      ],
    };

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output).toBe(input);
    expect(output.tools).toBeUndefined();
  });

  it.each([
    [
      "顶层 tools",
      {
        tools: [{ type: "namespace", name: "image_gen" }],
        input: [],
      },
    ],
    [
      "Responses Lite",
      {
        input: [
          {
            type: "additional_tools",
            tools: [{ type: "namespace", name: "image_gen" }],
          },
        ],
      },
    ],
  ])("当强制 image_generation=true 且%s已声明 namespace 时，allowed_tools 应使用同形引用", (_, request) => {
    const provider = {
      providerType: "codex",
      codexImageGenerationPreference: "true",
    };
    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      ...request,
      tool_choice: {
        type: "allowed_tools",
        mode: "auto",
        tools: [{ type: "function", name: "lookup_weather" }],
      },
    };

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output.tool_choice).toEqual({
      type: "allowed_tools",
      mode: "auto",
      tools: [
        { type: "function", name: "lookup_weather" },
        { type: "namespace", name: "image_gen" },
      ],
    });
    expect(output.tools).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "image_generation" })])
    );
  });

  it("当强制 image_generation=false 时，应从 tools 中移除对应工具", () => {
    const provider = {
      providerType: "codex",
      codexImageGenerationPreference: "false",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      tools: [{ type: "image_generation" }, { type: "function", name: "lookup_weather" }],
    };

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output.tools).toEqual([{ type: "function", name: "lookup_weather" }]);
    expect(input.tools).toEqual([
      { type: "image_generation" },
      { type: "function", name: "lookup_weather" },
    ]);
  });

  it("当强制 image_generation=false 时，应完整移除 namespace 和 Responses Lite 图片工具声明", () => {
    const provider = {
      id: 90,
      name: "codex-provider",
      providerType: "codex",
      codexImageGenerationPreference: "false",
    };

    const imageNamespace = {
      type: "namespace",
      name: "image_gen",
      tools: [{ type: "function", name: "imagegen" }],
    };
    const codeNamespace = {
      type: "namespace",
      name: "code_tools",
      tools: [{ type: "function", name: "run" }],
    };
    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      tools: [{ type: "function", name: "shell" }, imageNamespace, codeNamespace],
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
        { type: "additional_tools", tools: [imageNamespace] },
        { type: "additional_tools", tools: [imageNamespace, codeNamespace] },
      ],
      tool_choice: { type: "namespace", name: "image_gen" },
    };
    const snapshot = structuredClone(input);

    const result = applyCodexProviderOverridesWithAudit(provider as any, input);

    expect(result.request.tools).toEqual([{ type: "function", name: "shell" }, codeNamespace]);
    expect(result.request.input).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
      { type: "additional_tools", tools: [codeNamespace] },
    ]);
    expect(result.request.tool_choice).toBe("none");
    expect(input).toEqual(snapshot);

    expect(
      result.audit?.changes.find((change) => change.path === "tools.image_generation")
    ).toEqual({
      path: "tools.image_generation",
      before: true,
      after: false,
      changed: true,
    });
    expect(
      result.audit?.changes.find(
        (change) => change.path === "input.additional_tools.image_generation"
      )
    ).toEqual({
      path: "input.additional_tools.image_generation",
      before: true,
      after: false,
      changed: true,
    });
  });

  it("当强制 image_generation=false 且只有 Responses Lite 图片工具时，应独立清理并正确审计", () => {
    const provider = {
      id: 90,
      name: "codex-provider",
      providerType: "codex",
      codexImageGenerationPreference: "false",
    };
    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
        { type: "image_generation_call", id: "ig_123", result: "preserve" },
        {
          type: "additional_tools",
          tools: [{ type: "namespace", name: "image_gen" }],
        },
      ],
      include: ["image_generation_call.results"],
      tool_choice: "auto",
    };
    const snapshot = structuredClone(input);

    const result = applyCodexProviderOverridesWithAudit(provider as any, input);

    expect(result.request.input).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
      { type: "image_generation_call", id: "ig_123", result: "preserve" },
    ]);
    expect(result.request.include).toEqual(["image_generation_call.results"]);
    expect(result.request.tool_choice).toBeUndefined();
    expect(input).toEqual(snapshot);
    expect(
      result.audit?.changes.find((change) => change.path === "tools.image_generation")
    ).toEqual({
      path: "tools.image_generation",
      before: false,
      after: false,
      changed: false,
    });
    expect(
      result.audit?.changes.find(
        (change) => change.path === "input.additional_tools.image_generation"
      )
    ).toEqual({
      path: "input.additional_tools.image_generation",
      before: true,
      after: false,
      changed: true,
    });
  });

  it.each([
    ["字符串", "image_generation", "image_generation"],
    ["namespace 字段", { type: "namespace", namespace: "image_gen" }, "namespace:image_gen"],
    ["嵌套 tool", { tool: { type: "namespace", name: "image_gen" } }, "tool:image_generation"],
    ["function.name", { function: { name: "image_generation" } }, "function:image_generation"],
  ])("当强制 image_generation=false 时，应移除%s形式的 tool_choice 并记录审计", (_, toolChoice, auditValue) => {
    const provider = {
      providerType: "codex",
      codexImageGenerationPreference: "false",
    };
    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      tool_choice: toolChoice,
    };

    const result = applyCodexProviderOverridesWithAudit(provider as any, input);

    expect(result.request.tool_choice).toBeUndefined();
    expect(result.audit?.changes.find((change) => change.path === "tool_choice")).toEqual({
      path: "tool_choice",
      before: auditValue,
      after: null,
      changed: true,
    });
  });

  it("不应把其他 namespace 中名为 imagegen 的普通函数误判为图片工具", () => {
    const provider = {
      providerType: "codex",
      codexImageGenerationPreference: "false",
    };
    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      tools: [
        {
          type: "namespace",
          name: "media_tools",
          tools: [{ type: "function", name: "imagegen" }],
        },
      ],
    };

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output).toBe(input);
  });

  it("当强制 image_generation=false 且 tool_choice 直接指向 image_generation 时，应移除该选择", () => {
    const provider = {
      providerType: "codex",
      codexImageGenerationPreference: "false",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      tools: [{ type: "image_generation" }],
      tool_choice: { type: "image_generation" },
    };

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output.tools).toBeUndefined();
    expect(output.tool_choice).toBeUndefined();
  });

  it("当强制 image_generation=false 且仍有其他工具可用时，应将 image_generation 专属 tool_choice 收口为 none", () => {
    const provider = {
      providerType: "codex",
      codexImageGenerationPreference: "false",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      tools: [{ type: "image_generation" }, { type: "function", name: "lookup_weather" }],
      tool_choice: { type: "image_generation" },
    };

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output.tools).toEqual([{ type: "function", name: "lookup_weather" }]);
    expect(output.tool_choice).toBe("none");
  });

  it("当强制 image_generation=false 且 required 在移除最后一个工具后失效时，应移除 tool_choice", () => {
    const provider = {
      providerType: "codex",
      codexImageGenerationPreference: "false",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      tools: [{ type: "image_generation" }],
      tool_choice: "required",
    };

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output.tools).toBeUndefined();
    expect(output.tool_choice).toBeUndefined();
  });

  it("当强制 image_generation=false 且 allowed_tools 包含 image_generation 时，应剔除该项", () => {
    const provider = {
      providerType: "codex",
      codexImageGenerationPreference: "false",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      tools: [{ type: "image_generation" }, { type: "function", name: "lookup_weather" }],
      tool_choice: {
        type: "allowed_tools",
        mode: "auto",
        tools: [{ type: "image_generation" }, { type: "function", name: "lookup_weather" }],
      },
    };

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output.tools).toEqual([{ type: "function", name: "lookup_weather" }]);
    expect(output.tool_choice).toEqual({
      type: "allowed_tools",
      mode: "auto",
      tools: [{ type: "function", name: "lookup_weather" }],
    });
  });

  it("当强制 image_generation=false 且 allowed_tools 包含 image_gen namespace 时，应剔除该项", () => {
    const provider = {
      providerType: "codex",
      codexImageGenerationPreference: "false",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      tools: [{ type: "function", name: "lookup_weather" }],
      tool_choice: {
        type: "allowed_tools",
        mode: "auto",
        tools: [
          { type: "namespace", name: "image_gen" },
          { type: "function", name: "lookup_weather" },
        ],
      },
    };

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output.tool_choice).toEqual({
      type: "allowed_tools",
      mode: "auto",
      tools: [{ type: "function", name: "lookup_weather" }],
    });
  });

  it("当强制 image_generation=false 且 allowed_tools 仅白名单图像工具时，应收口为 none", () => {
    const provider = {
      providerType: "codex",
      codexImageGenerationPreference: "false",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      tools: [{ type: "image_generation" }, { type: "function", name: "lookup_weather" }],
      tool_choice: {
        type: "allowed_tools",
        mode: "auto",
        tools: [{ type: "image_generation" }],
      },
    };

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output.tools).toEqual([{ type: "function", name: "lookup_weather" }]);
    expect(output.tool_choice).toBe("none");
  });

  it("当强制 reasoning.effort/summary 时，应覆写并保留 reasoning 的其他字段", () => {
    const provider = {
      providerType: "codex",
      codexReasoningEffortPreference: "high",
      codexReasoningSummaryPreference: "detailed",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      reasoning: { effort: "low", summary: "auto", extra: "keep" },
    };

    const output = applyCodexProviderOverrides(provider as any, input);
    expect(output.reasoning).toEqual({ effort: "high", summary: "detailed", extra: "keep" });
    expect((input.reasoning as any).effort).toBe("low");
  });

  it("当请求缺少 reasoning/text 时，强制值应自动补齐对象结构", () => {
    const provider = {
      providerType: "codex",
      codexReasoningEffortPreference: "minimal",
      codexReasoningSummaryPreference: "auto",
      codexTextVerbosityPreference: "high",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
    };

    const output = applyCodexProviderOverrides(provider as any, input);
    expect(output.reasoning).toEqual({ effort: "minimal", summary: "auto" });
    expect(output.text).toEqual({ verbosity: "high" });
  });

  it("当强制 service_tier 时，应覆写顶层 service_tier 字段", () => {
    const provider = {
      providerType: "codex",
      codexServiceTierPreference: "priority",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      service_tier: "default",
    };

    const output = applyCodexProviderOverrides(provider as any, input);

    expect(output.service_tier).toBe("priority");
    expect(input.service_tier).toBe("default");
  });

  it("审计：当 providerType 不是 codex 时，应返回 audit=null 且保持引用不变", () => {
    const provider = {
      id: 123,
      name: "P",
      providerType: "claude",
      codexParallelToolCallsPreference: "false",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      parallel_tool_calls: true,
    };

    const result = applyCodexProviderOverridesWithAudit(provider as any, input);
    expect(result.request).toBe(input);
    expect(result.audit).toBeNull();
  });

  it("审计：当所有偏好均为 inherit/null 时，应返回 audit=null 且不做覆写", () => {
    const provider = {
      providerType: "codex",
      codexReasoningEffortPreference: "inherit",
      codexReasoningSummaryPreference: null,
      codexTextVerbosityPreference: "inherit",
      codexParallelToolCallsPreference: null,
      codexImageGenerationPreference: null,
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      parallel_tool_calls: false,
      reasoning: { effort: "low", summary: "auto" },
      text: { verbosity: "medium" },
    };

    const result = applyCodexProviderOverridesWithAudit(provider as any, input);
    expect(result.request).toBe(input);
    expect(result.audit).toBeNull();
  });

  it("审计：当偏好命中但值未变化时，应标记 changed=false 并记录 before/after", () => {
    const provider = {
      id: 1,
      name: "codex-provider",
      providerType: "codex",
      codexParallelToolCallsPreference: "false",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      parallel_tool_calls: false,
    };

    const result = applyCodexProviderOverridesWithAudit(provider as any, input);

    expect(result.audit?.hit).toBe(true);
    expect(result.audit?.changed).toBe(false);
    expect(result.audit?.providerId).toBe(1);
    expect(result.audit?.providerName).toBe("codex-provider");

    const parallelChange = result.audit?.changes.find((c) => c.path === "parallel_tool_calls");
    expect(parallelChange).toEqual({
      path: "parallel_tool_calls",
      before: false,
      after: false,
      changed: false,
    });
  });

  it("审计：当偏好命中且值变化时，应标记 changed=true 并记录变化明细", () => {
    const provider = {
      id: 2,
      name: "codex-provider",
      providerType: "codex",
      codexReasoningEffortPreference: "high",
      codexReasoningSummaryPreference: "detailed",
      codexTextVerbosityPreference: "high",
      codexParallelToolCallsPreference: "true",
      codexImageGenerationPreference: "false",
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      parallel_tool_calls: false,
      tools: [{ type: "image_generation" }],
      tool_choice: { type: "image_generation" },
      reasoning: { effort: "low", summary: "auto" },
      text: { verbosity: "low" },
    };

    const result = applyCodexProviderOverridesWithAudit(provider as any, input);

    expect(result.audit?.hit).toBe(true);
    expect(result.audit?.changed).toBe(true);

    const changedPaths = (result.audit?.changes ?? []).filter((c) => c.changed).map((c) => c.path);
    expect(changedPaths).toEqual([
      "parallel_tool_calls",
      "tools.image_generation",
      "reasoning.effort",
      "reasoning.summary",
      "text.verbosity",
      "tool_choice",
    ]);
  });

  it("审计：当客户端原本就携带 priority service_tier 时，也应保留 fast 命中记录", () => {
    const provider = {
      id: 2,
      name: "codex-provider",
      providerType: "codex",
      codexReasoningEffortPreference: "inherit",
      codexReasoningSummaryPreference: null,
      codexTextVerbosityPreference: null,
      codexParallelToolCallsPreference: null,
      codexImageGenerationPreference: null,
      codexServiceTierPreference: null,
    };

    const input: Record<string, unknown> = {
      model: "gpt-5.5",
      input: [],
      service_tier: "priority",
    };

    const result = applyCodexProviderOverridesWithAudit(provider as any, input);

    expect(result.audit?.hit).toBe(true);
    expect(result.audit?.changed).toBe(false);
    expect(result.audit?.changes).toContainEqual({
      path: "service_tier",
      before: "priority",
      after: "priority",
      changed: false,
    });
  });
});
