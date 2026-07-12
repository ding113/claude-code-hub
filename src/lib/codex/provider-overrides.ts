import type {
  CodexImageGenerationPreference,
  CodexParallelToolCallsPreference,
  CodexReasoningEffortPreference,
  CodexReasoningSummaryPreference,
  CodexServiceTierPreference,
  CodexTextVerbosityPreference,
} from "@/types/provider";
import type { ProviderParameterOverrideSpecialSetting } from "@/types/special-settings";

type CodexProviderOverrideConfig = {
  id?: number;
  name?: string;
  providerType?: string;
  codexReasoningEffortPreference?: CodexReasoningEffortPreference | null;
  codexReasoningSummaryPreference?: CodexReasoningSummaryPreference | null;
  codexTextVerbosityPreference?: CodexTextVerbosityPreference | null;
  codexParallelToolCallsPreference?: CodexParallelToolCallsPreference | null;
  codexImageGenerationPreference?: CodexImageGenerationPreference | null;
  codexServiceTierPreference?: CodexServiceTierPreference | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toAuditValue(value: unknown): string | number | boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

function normalizeStringPreference(value: string | null | undefined): string | null {
  if (!value || value === "inherit") return null;
  return value;
}

function normalizeParallelToolCallsPreference(
  value: CodexParallelToolCallsPreference | null | undefined
): boolean | null {
  if (!value || value === "inherit") return null;
  return value === "true";
}

function normalizeImageGenerationPreference(
  value: CodexImageGenerationPreference | null | undefined
): boolean | null {
  if (!value || value === "inherit") return null;
  return value === "true";
}

function toImageGenerationToolReference(value: unknown): Record<string, unknown> | null {
  if (!isPlainObject(value)) {
    return null;
  }
  if (value.type === "image_generation") {
    return { type: "image_generation" };
  }
  if (value.type === "namespace" && value.name === "image_gen") {
    return { type: "namespace", name: "image_gen" };
  }
  return null;
}

function isImageGenerationTool(value: unknown): boolean {
  return toImageGenerationToolReference(value) !== null;
}

function hasImageGenerationTool(value: unknown): boolean {
  return Array.isArray(value) && value.some((tool) => isImageGenerationTool(tool));
}

function hasInputImageGenerationTool(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      (item) =>
        isPlainObject(item) &&
        item.type === "additional_tools" &&
        hasImageGenerationTool(item.tools)
    )
  );
}

function findImageGenerationToolReference(
  request: Record<string, unknown>
): Record<string, unknown> | null {
  if (Array.isArray(request.tools)) {
    for (const tool of request.tools) {
      const reference = toImageGenerationToolReference(tool);
      if (reference) {
        return reference;
      }
    }
  }

  if (!Array.isArray(request.input)) {
    return null;
  }
  for (const item of request.input) {
    if (!isPlainObject(item) || item.type !== "additional_tools" || !Array.isArray(item.tools)) {
      continue;
    }
    for (const tool of item.tools) {
      const reference = toImageGenerationToolReference(tool);
      if (reference) {
        return reference;
      }
    }
  }
  return null;
}

function hasAvailableTool(request: Record<string, unknown>): boolean {
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    return true;
  }
  return (
    Array.isArray(request.input) &&
    request.input.some(
      (item) =>
        isPlainObject(item) &&
        item.type === "additional_tools" &&
        Array.isArray(item.tools) &&
        item.tools.length > 0
    )
  );
}

function applyImageGenerationToolPreference(
  request: Record<string, unknown>,
  ensureCloned: () => Record<string, unknown>,
  enabled: boolean | null
): void {
  if (enabled === null) {
    return;
  }

  const existingTools = Array.isArray(request.tools) ? request.tools : null;
  if (enabled) {
    if (
      existingTools?.some((tool) => isImageGenerationTool(tool)) ||
      hasInputImageGenerationTool(request.input)
    ) {
      return;
    }
    const target = ensureCloned();
    const nextTools = existingTools ? [...existingTools] : [];
    nextTools.push({ type: "image_generation" });
    target.tools = nextTools;
    return;
  }

  if (!existingTools) {
    return;
  }

  const nextTools = existingTools.filter((tool) => !isImageGenerationTool(tool));
  if (nextTools.length === existingTools.length) {
    return;
  }

  const target = ensureCloned();
  if (nextTools.length > 0) {
    target.tools = nextTools;
  } else {
    delete target.tools;
  }
}

function applyInputImageGenerationToolPreference(
  request: Record<string, unknown>,
  ensureCloned: () => Record<string, unknown>,
  enabled: boolean | null
): void {
  if (enabled !== false || !Array.isArray(request.input)) {
    return;
  }

  const nextInput: unknown[] = [];
  let changed = false;
  for (const item of request.input) {
    if (!isPlainObject(item) || item.type !== "additional_tools" || !Array.isArray(item.tools)) {
      nextInput.push(item);
      continue;
    }

    const nextTools = item.tools.filter((tool) => !isImageGenerationTool(tool));
    if (nextTools.length === item.tools.length) {
      nextInput.push(item);
      continue;
    }

    changed = true;
    if (nextTools.length > 0) {
      nextInput.push({ ...item, tools: nextTools });
    }
  }

  if (changed) {
    ensureCloned().input = nextInput;
  }
}

function isImageGenerationToolChoice(value: unknown): boolean {
  if (typeof value === "string") {
    return value === "image_generation";
  }
  if (!isPlainObject(value)) {
    return false;
  }
  if (isImageGenerationTool(value)) {
    return true;
  }
  if (value.type === "namespace" && value.namespace === "image_gen") {
    return true;
  }
  if (isImageGenerationToolChoice(value.tool)) {
    return true;
  }
  return isPlainObject(value.function) && value.function.name === "image_generation";
}

function summarizeImageGenerationToolChoice(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (!isPlainObject(value)) {
    return null;
  }
  if (isImageGenerationToolChoice(value.tool)) {
    return "tool:image_generation";
  }
  if (isPlainObject(value.function) && value.function.name === "image_generation") {
    return "function:image_generation";
  }
  if (typeof value.type !== "string") {
    return null;
  }
  if (value.type === "image_generation") {
    return "image_generation";
  }
  if (
    value.type === "namespace" &&
    (value.name === "image_gen" || value.namespace === "image_gen")
  ) {
    return "namespace:image_gen";
  }
  if (value.type !== "allowed_tools") {
    return value.type;
  }

  const allowedTools = Array.isArray(value.tools) ? value.tools : [];
  const imageToolCount = allowedTools.filter((tool) => isImageGenerationTool(tool)).length;
  if (imageToolCount === 0) {
    return "allowed_tools";
  }
  if (imageToolCount === allowedTools.length) {
    return "allowed_tools:image_generation_only";
  }
  return "allowed_tools:includes_image_generation";
}

function applyImageGenerationToolChoicePreference(
  request: Record<string, unknown>,
  ensureCloned: () => Record<string, unknown>,
  enabled: boolean | null,
  context: {
    imageGenerationToolReference: Record<string, unknown> | null;
    hasAvailableTools: boolean;
  }
): void {
  const toolChoice = request.tool_choice;

  if (enabled === true) {
    if (
      !isPlainObject(toolChoice) ||
      toolChoice.type !== "allowed_tools" ||
      !Array.isArray(toolChoice.tools) ||
      toolChoice.tools.some((tool) => isImageGenerationTool(tool))
    ) {
      return;
    }

    const target = ensureCloned();
    target.tool_choice = {
      ...toolChoice,
      tools: [
        ...toolChoice.tools,
        context.imageGenerationToolReference ?? { type: "image_generation" },
      ],
    };
    return;
  }

  if (enabled !== false) {
    return;
  }

  if (!context.hasAvailableTools) {
    if (toolChoice !== undefined) {
      const target = ensureCloned();
      delete target.tool_choice;
    }
    return;
  }

  if (isImageGenerationToolChoice(toolChoice)) {
    const target = ensureCloned();
    // 只剩非图像工具时改成 none，避免回退到 auto 后放宽客户端原本的工具限制。
    target.tool_choice = "none";
    return;
  }

  if (
    !isPlainObject(toolChoice) ||
    toolChoice.type !== "allowed_tools" ||
    !Array.isArray(toolChoice.tools)
  ) {
    return;
  }

  const nextAllowedTools = toolChoice.tools.filter((tool) => !isImageGenerationTool(tool));
  if (nextAllowedTools.length === toolChoice.tools.length) {
    return;
  }

  const target = ensureCloned();
  if (nextAllowedTools.length > 0) {
    target.tool_choice = { ...toolChoice, tools: nextAllowedTools };
  } else {
    // 白名单被清空后不能回退到 auto，否则剩余工具会重新暴露给模型。
    target.tool_choice = "none";
  }
}

/**
 * 根据供应商配置对 Codex（Responses API）请求体进行覆写。
 *
 * 约定：
 * - providerType !== "codex" 时不做任何处理
 * - 偏好值为 null/undefined/"inherit" 表示“遵循客户端”
 * - 覆写仅影响以下字段：
 *   - parallel_tool_calls
 *   - tools / input.additional_tools / tool_choice 中与 image_generation 相关的能力声明
 *   - reasoning.effort / reasoning.summary
 *   - service_tier
 *   - text.verbosity
 */
export function applyCodexProviderOverrides(
  provider: CodexProviderOverrideConfig,
  request: Record<string, unknown>
): Record<string, unknown> {
  if (provider.providerType !== "codex") {
    return request;
  }

  let output: Record<string, unknown> = request;
  const ensureCloned = () => {
    if (output === request) {
      output = { ...request };
    }
    return output;
  };

  const parallelToolCalls = normalizeParallelToolCallsPreference(
    provider.codexParallelToolCallsPreference
  );
  if (parallelToolCalls !== null) {
    ensureCloned().parallel_tool_calls = parallelToolCalls;
  }

  const imageGeneration = normalizeImageGenerationPreference(
    provider.codexImageGenerationPreference
  );
  if (imageGeneration !== null) {
    applyImageGenerationToolPreference(output, ensureCloned, imageGeneration);
    applyInputImageGenerationToolPreference(output, ensureCloned, imageGeneration);
    applyImageGenerationToolChoicePreference(output, ensureCloned, imageGeneration, {
      imageGenerationToolReference: findImageGenerationToolReference(output),
      hasAvailableTools: hasAvailableTool(output),
    });
  }

  const reasoningEffort = normalizeStringPreference(provider.codexReasoningEffortPreference);
  const reasoningSummary = normalizeStringPreference(provider.codexReasoningSummaryPreference);
  if (reasoningEffort !== null || reasoningSummary !== null) {
    const target = ensureCloned();
    const existingReasoning = isPlainObject(output.reasoning) ? output.reasoning : {};
    const nextReasoning: Record<string, unknown> = { ...existingReasoning };
    if (reasoningEffort !== null) {
      nextReasoning.effort = reasoningEffort;
    }
    if (reasoningSummary !== null) {
      nextReasoning.summary = reasoningSummary;
    }
    target.reasoning = nextReasoning;
  }

  const textVerbosity = normalizeStringPreference(provider.codexTextVerbosityPreference);
  if (textVerbosity !== null) {
    const target = ensureCloned();
    const existingText = isPlainObject(output.text) ? output.text : {};
    const nextText: Record<string, unknown> = { ...existingText, verbosity: textVerbosity };
    target.text = nextText;
  }

  const serviceTier = normalizeStringPreference(provider.codexServiceTierPreference);
  if (serviceTier !== null) {
    ensureCloned().service_tier = serviceTier;
  }

  return output;
}

export function applyCodexProviderOverridesWithAudit(
  provider: CodexProviderOverrideConfig,
  request: Record<string, unknown>
): { request: Record<string, unknown>; audit: ProviderParameterOverrideSpecialSetting | null } {
  if (provider.providerType !== "codex") {
    return { request, audit: null };
  }

  const parallelToolCalls = normalizeParallelToolCallsPreference(
    provider.codexParallelToolCallsPreference
  );
  const reasoningEffort = normalizeStringPreference(provider.codexReasoningEffortPreference);
  const reasoningSummary = normalizeStringPreference(provider.codexReasoningSummaryPreference);
  const textVerbosity = normalizeStringPreference(provider.codexTextVerbosityPreference);
  const imageGeneration = normalizeImageGenerationPreference(
    provider.codexImageGenerationPreference
  );
  const serviceTier = normalizeStringPreference(provider.codexServiceTierPreference);

  const beforeServiceTier = toAuditValue(request.service_tier);
  const hit =
    parallelToolCalls !== null ||
    imageGeneration !== null ||
    reasoningEffort !== null ||
    reasoningSummary !== null ||
    textVerbosity !== null ||
    serviceTier !== null ||
    beforeServiceTier === "priority";

  if (!hit) {
    return { request, audit: null };
  }

  const beforeImageGeneration = hasImageGenerationTool(request.tools);
  const beforeInputImageGeneration = hasInputImageGenerationTool(request.input);
  const beforeParallelToolCalls = toAuditValue(request.parallel_tool_calls);
  const beforeReasoning = isPlainObject(request.reasoning) ? request.reasoning : null;
  const beforeReasoningEffort = toAuditValue(beforeReasoning?.effort);
  const beforeReasoningSummary = toAuditValue(beforeReasoning?.summary);
  const beforeText = isPlainObject(request.text) ? request.text : null;
  const beforeTextVerbosity = toAuditValue(beforeText?.verbosity);
  const beforeToolChoice = summarizeImageGenerationToolChoice(request.tool_choice);

  const nextRequest = applyCodexProviderOverrides(provider, request);

  const afterServiceTier = toAuditValue(nextRequest.service_tier);

  const afterParallelToolCalls = toAuditValue(nextRequest.parallel_tool_calls);
  const afterImageGeneration = hasImageGenerationTool(nextRequest.tools);
  const afterInputImageGeneration = hasInputImageGenerationTool(nextRequest.input);
  const afterReasoning = isPlainObject(nextRequest.reasoning) ? nextRequest.reasoning : null;
  const afterReasoningEffort = toAuditValue(afterReasoning?.effort);
  const afterReasoningSummary = toAuditValue(afterReasoning?.summary);
  const afterText = isPlainObject(nextRequest.text) ? nextRequest.text : null;
  const afterTextVerbosity = toAuditValue(afterText?.verbosity);
  const afterToolChoice = summarizeImageGenerationToolChoice(nextRequest.tool_choice);

  const changes: ProviderParameterOverrideSpecialSetting["changes"] = [
    {
      path: "parallel_tool_calls",
      before: beforeParallelToolCalls,
      after: afterParallelToolCalls,
      changed: !Object.is(beforeParallelToolCalls, afterParallelToolCalls),
    },
    {
      path: "tools.image_generation",
      before: beforeImageGeneration,
      after: afterImageGeneration,
      changed: !Object.is(beforeImageGeneration, afterImageGeneration),
    },
    {
      path: "input.additional_tools.image_generation",
      before: beforeInputImageGeneration,
      after: afterInputImageGeneration,
      changed: !Object.is(beforeInputImageGeneration, afterInputImageGeneration),
    },
    {
      path: "reasoning.effort",
      before: beforeReasoningEffort,
      after: afterReasoningEffort,
      changed: !Object.is(beforeReasoningEffort, afterReasoningEffort),
    },
    {
      path: "reasoning.summary",
      before: beforeReasoningSummary,
      after: afterReasoningSummary,
      changed: !Object.is(beforeReasoningSummary, afterReasoningSummary),
    },
    {
      path: "service_tier",
      before: beforeServiceTier,
      after: afterServiceTier,
      changed: !Object.is(beforeServiceTier, afterServiceTier),
    },
    {
      path: "text.verbosity",
      before: beforeTextVerbosity,
      after: afterTextVerbosity,
      changed: !Object.is(beforeTextVerbosity, afterTextVerbosity),
    },
    {
      path: "tool_choice",
      before: beforeToolChoice,
      after: afterToolChoice,
      changed: !Object.is(beforeToolChoice, afterToolChoice),
    },
  ];

  const audit: ProviderParameterOverrideSpecialSetting = {
    type: "provider_parameter_override",
    scope: "provider",
    providerId: provider.id ?? null,
    providerName: provider.name ?? null,
    providerType: provider.providerType ?? null,
    hit: true,
    changed: changes.some((c) => c.changed),
    changes,
  };

  return { request: nextRequest, audit };
}
