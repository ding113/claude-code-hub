import type {
  CodexParallelToolCallsPreference,
  CodexReasoningEffortPreference,
  CodexReasoningSummaryPreference,
  CodexTextVerbosityPreference,
} from "@/types/provider";

type CodexProviderOverrideConfig = {
  providerType?: string;
  codexReasoningEffortPreference?: CodexReasoningEffortPreference | null;
  codexReasoningSummaryPreference?: CodexReasoningSummaryPreference | null;
  codexTextVerbosityPreference?: CodexTextVerbosityPreference | null;
  codexParallelToolCallsPreference?: CodexParallelToolCallsPreference | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

/**
 * 根据供应商配置对 Codex（Responses API）请求体进行覆写。
 *
 * 约定：
 * - providerType !== "codex" 时不做任何处理
 * - 偏好值为 null/undefined/"inherit" 表示“遵循客户端”
 * - 覆写仅影响以下字段：
 *   - parallel_tool_calls
 *   - reasoning.effort / reasoning.summary
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
  };

  const parallelToolCalls = normalizeParallelToolCallsPreference(
    provider.codexParallelToolCallsPreference
  );
  if (parallelToolCalls !== null) {
    ensureCloned();
    output.parallel_tool_calls = parallelToolCalls;
  }

  const reasoningEffort = normalizeStringPreference(provider.codexReasoningEffortPreference);
  const reasoningSummary = normalizeStringPreference(provider.codexReasoningSummaryPreference);
  if (reasoningEffort !== null || reasoningSummary !== null) {
    ensureCloned();
    const existingReasoning = isPlainObject(output.reasoning) ? output.reasoning : {};
    const nextReasoning: Record<string, unknown> = { ...existingReasoning };
    if (reasoningEffort !== null) {
      nextReasoning.effort = reasoningEffort;
    }
    if (reasoningSummary !== null) {
      nextReasoning.summary = reasoningSummary;
    }
    output.reasoning = nextReasoning;
  }

  const textVerbosity = normalizeStringPreference(provider.codexTextVerbosityPreference);
  if (textVerbosity !== null) {
    ensureCloned();
    const existingText = isPlainObject(output.text) ? output.text : {};
    const nextText: Record<string, unknown> = { ...existingText, verbosity: textVerbosity };
    output.text = nextText;
  }

  return output;
}
