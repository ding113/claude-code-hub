import type { SpecialSetting } from "@/types/special-settings";

export type ReasoningEffortPath = "output_config.effort" | "reasoning.effort" | "reasoning_effort";

function normalizeReasoningEffort(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractAnthropicEffortFromRequestBody(requestBody: unknown): string | null {
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
    return null;
  }

  const outputConfig = (requestBody as Record<string, unknown>).output_config;
  if (!outputConfig || typeof outputConfig !== "object" || Array.isArray(outputConfig)) {
    return null;
  }

  return normalizeReasoningEffort((outputConfig as Record<string, unknown>).effort);
}

export function extractReasoningEffortSettingFromRequestBody(requestBody: unknown): {
  path: ReasoningEffortPath;
  effort: string;
} | null {
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
    return null;
  }

  const record = requestBody as Record<string, unknown>;
  const outputConfig = record.output_config;
  if (outputConfig && typeof outputConfig === "object" && !Array.isArray(outputConfig)) {
    const effort = normalizeReasoningEffort((outputConfig as Record<string, unknown>).effort);
    if (effort) {
      return { path: "output_config.effort", effort };
    }
  }

  const reasoning = record.reasoning;
  if (reasoning && typeof reasoning === "object" && !Array.isArray(reasoning)) {
    const effort = normalizeReasoningEffort((reasoning as Record<string, unknown>).effort);
    if (effort) {
      return { path: "reasoning.effort", effort };
    }
  }

  // DeepSeek 风格：顶层 reasoning_effort 字段
  const topLevelEffort = normalizeReasoningEffort(record.reasoning_effort);
  if (topLevelEffort) {
    return { path: "reasoning_effort", effort: topLevelEffort };
  }

  return null;
}

export function extractAnthropicEffortFromSpecialSettings(
  specialSettings: SpecialSetting[] | null | undefined
): string | null {
  if (!Array.isArray(specialSettings)) {
    return null;
  }

  for (const setting of specialSettings) {
    if (setting.type !== "anthropic_effort") {
      continue;
    }

    const normalized = normalizeReasoningEffort(setting.effort);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function extractReasoningEffortSettingFromSpecialSettings(
  specialSettings: SpecialSetting[] | null | undefined
): { path: ReasoningEffortPath; effort: string } | null {
  if (!Array.isArray(specialSettings)) {
    return null;
  }

  for (const setting of specialSettings) {
    if (setting.type !== "reasoning_effort") {
      continue;
    }

    const effort = normalizeReasoningEffort(setting.effort);
    if (effort) {
      return {
        path: setting.path,
        effort,
      };
    }
  }

  return null;
}

export interface ReasoningEffortInfo {
  originalEffort: string;
  overriddenEffort: string | null;
  isOverridden: boolean;
  path: ReasoningEffortPath;
  hasRequestEffort: boolean;
}

export type AnthropicEffortOverrideInfo = ReasoningEffortInfo;

function findOverrideChange(
  specialSettings: SpecialSetting[],
  preferredPath: ReasoningEffortPath | null
): {
  path: ReasoningEffortPath;
  before: string | null;
  after: string | null;
  changed: boolean;
} | null {
  const candidatePaths: ReasoningEffortPath[] = preferredPath
    ? [
        preferredPath,
        ...(preferredPath === "output_config.effort"
          ? (["reasoning.effort", "reasoning_effort"] as const)
          : preferredPath === "reasoning_effort"
            ? (["output_config.effort", "reasoning.effort"] as const)
            : (["output_config.effort"] as const)),
      ]
    : ["output_config.effort", "reasoning.effort", "reasoning_effort"];

  for (const candidatePath of candidatePaths) {
    for (const setting of specialSettings) {
      if (setting.type !== "provider_parameter_override") {
        continue;
      }

      for (const change of setting.changes) {
        if (change.path !== candidatePath || !change.changed) {
          continue;
        }

        return {
          path: candidatePath,
          before: normalizeReasoningEffort(change.before),
          after: normalizeReasoningEffort(change.after),
          changed: true,
        };
      }
    }
  }

  return null;
}

/**
 * Extract request reasoning effort with provider-override detection from special settings.
 *
 * Resolution order:
 * 1. Generic `reasoning_effort` request audit entries.
 * 2. Legacy `anthropic_effort` request audit entries.
 * 3. Provider override audit changes on `output_config.effort` / `reasoning.effort`.
 */
export function extractReasoningEffortInfo(
  specialSettings: SpecialSetting[] | null | undefined
): ReasoningEffortInfo | null {
  if (!Array.isArray(specialSettings) || specialSettings.length === 0) {
    return null;
  }

  const genericSetting = extractReasoningEffortSettingFromSpecialSettings(specialSettings);
  const legacyAnthropicEffort = extractAnthropicEffortFromSpecialSettings(specialSettings);
  const originalPath =
    genericSetting?.path ?? (legacyAnthropicEffort ? "output_config.effort" : null);
  const originalEffort = genericSetting?.effort ?? legacyAnthropicEffort;
  const overrideChange = findOverrideChange(specialSettings, originalPath);

  if (overrideChange?.changed) {
    const effectiveOriginalEffort = originalEffort ?? overrideChange.before ?? overrideChange.after;
    if (!effectiveOriginalEffort) {
      return null;
    }

    return {
      originalEffort: effectiveOriginalEffort,
      overriddenEffort: overrideChange.after,
      isOverridden: true,
      path: originalPath ?? overrideChange.path,
      hasRequestEffort: Boolean(originalEffort ?? overrideChange.before),
    };
  }

  if (!originalEffort || !originalPath) {
    return null;
  }

  return {
    originalEffort,
    overriddenEffort: null,
    isOverridden: false,
    path: originalPath,
    hasRequestEffort: true,
  };
}

export function extractAnthropicEffortInfo(
  specialSettings: SpecialSetting[] | null | undefined
): AnthropicEffortOverrideInfo | null {
  return extractReasoningEffortInfo(specialSettings);
}
