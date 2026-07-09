import type { SpecialSetting } from "@/types/special-settings";

/** Codex 使用记录中用于呈现请求值和实际转发值的思考强度信息。 */
export interface CodexReasoningEffortInfo {
  requestedEffort: string | null;
  effectiveEffort: string;
  isOverridden: boolean;
}

/** 过滤非字符串及空白值，避免把无效参数写入审计记录。 */
function normalizeCodexReasoningEffort(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 从 Codex Responses 请求体的 reasoning.effort 读取客户端思考强度。 */
export function extractCodexReasoningEffortFromRequestBody(requestBody: unknown): string | null {
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
    return null;
  }

  const reasoning = (requestBody as Record<string, unknown>).reasoning;
  if (!reasoning || typeof reasoning !== "object" || Array.isArray(reasoning)) {
    return null;
  }

  return normalizeCodexReasoningEffort((reasoning as Record<string, unknown>).effort);
}

/** 从使用记录审计中读取客户端最初声明的 Codex 思考强度。 */
export function extractCodexReasoningEffortFromSpecialSettings(
  specialSettings: SpecialSetting[] | null | undefined
): string | null {
  if (!Array.isArray(specialSettings)) {
    return null;
  }

  for (const setting of specialSettings) {
    if (setting.type !== "codex_reasoning_effort") {
      continue;
    }

    const effort = normalizeCodexReasoningEffort(setting.effort);
    if (effort) {
      return effort;
    }
  }

  return null;
}

/**
 * 合并 Codex 客户端请求审计与供应商覆写审计。
 *
 * 新记录优先使用 codex_reasoning_effort；历史记录若只有 provider_parameter_override，
 * 仍可从 reasoning.effort 的 before/after 值恢复展示信息。
 */
export function extractCodexReasoningEffortInfo(
  specialSettings: SpecialSetting[] | null | undefined
): CodexReasoningEffortInfo | null {
  if (!Array.isArray(specialSettings) || specialSettings.length === 0) {
    return null;
  }

  const requestedEffort = extractCodexReasoningEffortFromSpecialSettings(specialSettings);
  let overrideBefore: string | null = null;
  let overrideAfter: string | null = null;
  let overrideChanged = false;

  for (const setting of specialSettings) {
    if (setting.type !== "provider_parameter_override" || setting.providerType !== "codex") {
      continue;
    }

    const effortChange = setting.changes.find((change) => change.path === "reasoning.effort");
    if (!effortChange) {
      continue;
    }

    overrideBefore = normalizeCodexReasoningEffort(effortChange.before);
    overrideAfter = normalizeCodexReasoningEffort(effortChange.after);
    overrideChanged = effortChange.changed;
    break;
  }

  if (overrideChanged && overrideAfter) {
    return {
      requestedEffort: requestedEffort ?? overrideBefore,
      effectiveEffort: overrideAfter,
      isOverridden: true,
    };
  }

  const effectiveEffort = requestedEffort ?? overrideAfter ?? overrideBefore;
  if (!effectiveEffort) {
    return null;
  }

  return {
    requestedEffort: effectiveEffort,
    effectiveEffort,
    isOverridden: false,
  };
}
