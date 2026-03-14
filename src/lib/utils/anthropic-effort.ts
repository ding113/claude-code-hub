import type { SpecialSetting } from "@/types/special-settings";

function normalizeAnthropicEffort(value: unknown): string | null {
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

  return normalizeAnthropicEffort((outputConfig as Record<string, unknown>).effort);
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

    const normalized = normalizeAnthropicEffort(setting.effort);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export interface AnthropicEffortOverrideInfo {
  originalEffort: string;
  overriddenEffort: string | null;
  isOverridden: boolean;
}

/**
 * Extract anthropic effort info with override detection from special settings.
 *
 * Combines `anthropic_effort` (original client request) with
 * `provider_parameter_override` changes on `output_config.effort`
 * to determine whether effort was overridden by a provider.
 */
export function extractAnthropicEffortInfo(
  specialSettings: SpecialSetting[] | null | undefined
): AnthropicEffortOverrideInfo | null {
  if (!Array.isArray(specialSettings) || specialSettings.length === 0) {
    return null;
  }

  const originalEffort = extractAnthropicEffortFromSpecialSettings(specialSettings);

  let overrideBefore: string | null = null;
  let overrideAfter: string | null = null;
  let overrideChanged = false;

  for (const setting of specialSettings) {
    if (setting.type !== "provider_parameter_override") {
      continue;
    }
    for (const change of setting.changes) {
      if (change.path === "output_config.effort") {
        overrideBefore = normalizeAnthropicEffort(change.before);
        overrideAfter = normalizeAnthropicEffort(change.after);
        overrideChanged = change.changed;
        break;
      }
    }
    if (overrideChanged) break;
  }

  if (overrideChanged) {
    const effective = originalEffort ?? overrideBefore;
    if (!effective) return null;
    return {
      originalEffort: effective,
      overriddenEffort: overrideAfter,
      isOverridden: true,
    };
  }

  if (originalEffort) {
    return {
      originalEffort,
      overriddenEffort: null,
      isOverridden: false,
    };
  }

  return null;
}
