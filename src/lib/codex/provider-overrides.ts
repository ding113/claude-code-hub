import type {
  CodexParallelToolCallsPreference,
  CodexReasoningEffortPreference,
  CodexReasoningSummaryPreference,
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

  const hit =
    parallelToolCalls !== null ||
    reasoningEffort !== null ||
    reasoningSummary !== null ||
    textVerbosity !== null;

  if (!hit) {
    return { request, audit: null };
  }

  const beforeParallelToolCalls = toAuditValue(request.parallel_tool_calls);
  const beforeReasoning = isPlainObject(request.reasoning) ? request.reasoning : null;
  const beforeReasoningEffort = toAuditValue(beforeReasoning?.effort);
  const beforeReasoningSummary = toAuditValue(beforeReasoning?.summary);
  const beforeText = isPlainObject(request.text) ? request.text : null;
  const beforeTextVerbosity = toAuditValue(beforeText?.verbosity);

  const nextRequest = applyCodexProviderOverrides(provider, request);

  const afterParallelToolCalls = toAuditValue(nextRequest.parallel_tool_calls);
  const afterReasoning = isPlainObject(nextRequest.reasoning) ? nextRequest.reasoning : null;
  const afterReasoningEffort = toAuditValue(afterReasoning?.effort);
  const afterReasoningSummary = toAuditValue(afterReasoning?.summary);
  const afterText = isPlainObject(nextRequest.text) ? nextRequest.text : null;
  const afterTextVerbosity = toAuditValue(afterText?.verbosity);

  const changes: ProviderParameterOverrideSpecialSetting["changes"] = [
    {
      path: "parallel_tool_calls",
      before: beforeParallelToolCalls,
      after: afterParallelToolCalls,
      changed: !Object.is(beforeParallelToolCalls, afterParallelToolCalls),
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
      path: "text.verbosity",
      before: beforeTextVerbosity,
      after: afterTextVerbosity,
      changed: !Object.is(beforeTextVerbosity, afterTextVerbosity),
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
