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
