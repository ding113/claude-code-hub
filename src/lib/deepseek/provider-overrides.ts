import type { DeepSeekReasoningEffortPreference } from "@/types/provider";
import type { ProviderParameterOverrideSpecialSetting } from "@/types/special-settings";

type DeepSeekProviderOverrideConfig = {
  id?: number;
  name?: string;
  providerType?: string;
  deepseekReasoningEffortPreference?: DeepSeekReasoningEffortPreference | null;
};

function normalizeStringPreference(value: string | null | undefined): string | null {
  if (!value || value === "inherit") return null;
  return value;
}

function toAuditValue(value: unknown): string | number | boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

/**
 * 判断请求体是否为 Anthropic Claude 格式
 * Anthropic 格式请求包含 output_config 字段，用于控制 thinking budget / effort
 */
function isAnthropicFormatRequest(request: Record<string, unknown>): boolean {
  return "output_config" in request || "thinking" in request;
}

/**
 * 根据供应商配置对 DeepSeek 请求体进行覆写。
 *
 * 支持两种协议格式：
 * 1. OpenAI Chat Completions 格式: 顶层 `reasoning_effort: "high"|"max"`
 * 2. Anthropic Messages 格式: `output_config: { effort: "high"|"max" }`
 *
 * 约定：
 * - providerType !== "deepseek" 时不做任何处理
 * - 偏好值为 null/undefined/"inherit" 表示"遵循客户端"
 *
 * DeepSeek V4 仅支持两个等级：
 * - "high": 默认级别，常规 CoT 推理
 * - "max": 最大推理力度（注入 [REASONING_EFFORT_MAX] prompt 前缀）
 */
export function applyDeepSeekProviderOverrides(
  provider: DeepSeekProviderOverrideConfig,
  request: Record<string, unknown>
): Record<string, unknown> {
  if (provider.providerType !== "deepseek") {
    return request;
  }

  const reasoningEffort = normalizeStringPreference(provider.deepseekReasoningEffortPreference);
  if (reasoningEffort === null) {
    return request;
  }

  const isAnthropic = isAnthropicFormatRequest(request);

  if (isAnthropic) {
    // Anthropic Messages API 格式: 设置 output_config.effort
    const existingOutputConfig =
      request.output_config &&
      typeof request.output_config === "object" &&
      !Array.isArray(request.output_config)
        ? { ...(request.output_config as Record<string, unknown>) }
        : {};
    return {
      ...request,
      output_config: {
        ...existingOutputConfig,
        effort: reasoningEffort,
      },
    };
  }

  // OpenAI Chat Completions 格式: 设置顶层 reasoning_effort
  return {
    ...request,
    reasoning_effort: reasoningEffort,
  };
}

export function applyDeepSeekProviderOverridesWithAudit(
  provider: DeepSeekProviderOverrideConfig,
  request: Record<string, unknown>
): { request: Record<string, unknown>; audit: ProviderParameterOverrideSpecialSetting | null } {
  if (provider.providerType !== "deepseek") {
    return { request, audit: null };
  }

  const reasoningEffort = normalizeStringPreference(provider.deepseekReasoningEffortPreference);

  if (reasoningEffort === null) {
    return { request, audit: null };
  }

  const isAnthropic = isAnthropicFormatRequest(request);
  const effortPath = isAnthropic ? "output_config.effort" : "reasoning_effort";

  // 读取 before 值
  let beforeEffort: string | number | boolean | null = null;
  if (isAnthropic) {
    const outputConfig = request.output_config;
    if (outputConfig && typeof outputConfig === "object" && !Array.isArray(outputConfig)) {
      beforeEffort = toAuditValue((outputConfig as Record<string, unknown>).effort);
    }
  } else {
    beforeEffort = toAuditValue(request.reasoning_effort);
  }

  const nextRequest = applyDeepSeekProviderOverrides(provider, request);

  // 读取 after 值
  let afterEffort: string | number | boolean | null = null;
  if (isAnthropic) {
    const outputConfig = nextRequest.output_config;
    if (outputConfig && typeof outputConfig === "object" && !Array.isArray(outputConfig)) {
      afterEffort = toAuditValue((outputConfig as Record<string, unknown>).effort);
    }
  } else {
    afterEffort = toAuditValue(nextRequest.reasoning_effort);
  }

  const changes: ProviderParameterOverrideSpecialSetting["changes"] = [
    {
      path: effortPath,
      before: beforeEffort,
      after: afterEffort,
      changed: !Object.is(beforeEffort, afterEffort),
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
