/**
 * Normalization and matching helpers for group-configured scheduled health-test models.
 */

import { resolveProviderGroupsWithDefault } from "@/lib/utils/provider-group";

export const PROVIDER_GROUP_HEALTH_TEST_MODEL_MAX_LENGTH = 200;
/** Max scheduled health-test models per group. Was 2; widened 2026-08-09. */
export const PROVIDER_GROUP_HEALTH_TEST_MODEL_MAX_COUNT = 20;

/** Normalize a group model list and preserve the old single-model field as a fallback. */
export function normalizeProviderGroupHealthTestModels(
  raw: unknown,
  legacyModel?: unknown
): string[] {
  const hasNewModelList = Array.isArray(raw);
  const candidates: unknown[] = hasNewModelList ? [...(raw as unknown[])] : [];
  if (!hasNewModelList && typeof legacyModel === "string") {
    candidates.push(legacyModel);
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const model = candidate.trim().slice(0, PROVIDER_GROUP_HEALTH_TEST_MODEL_MAX_LENGTH);
    if (!model || seen.has(model)) continue;
    seen.add(model);
    result.push(model);
    if (result.length >= PROVIDER_GROUP_HEALTH_TEST_MODEL_MAX_COUNT) break;
  }
  return result;
}

/**
 * Return whether a request model has a dedicated health-test configuration for
 * at least one group carried by this provider (or the default group when it is untagged).
 */
export function providerHasConfiguredHealthTestModel(
  groupTag: string | null | undefined,
  requestedModel: string,
  modelsByGroup: ReadonlyMap<string, string[] | null | undefined>
): boolean {
  const model = requestedModel.trim();
  if (!model) return false;
  return resolveProviderGroupsWithDefault(groupTag).some((tag) =>
    (modelsByGroup.get(tag) ?? []).includes(model)
  );
}

/** First configured model, used by legacy callers and display fields. */
export function firstProviderGroupHealthTestModel(
  raw: unknown,
  legacyModel?: unknown
): string | null {
  return normalizeProviderGroupHealthTestModels(raw, legacyModel)[0] ?? null;
}

/**
 * Resolve the model whose independent health result should stand in for
 * requests that are not themselves configured as scheduled test models.
 *
 * A stored fallback is accepted only when it belongs to the normalized model
 * list. Missing/invalid legacy data falls back to the first configured model
 * so existing single-model groups retain their previous behavior.
 */
export function resolveProviderGroupHealthTestModelFallback(
  rawFallback: unknown,
  models: readonly string[],
  legacyModel?: unknown
): string | null {
  const normalizedModels = normalizeProviderGroupHealthTestModels(models, legacyModel);
  if (normalizedModels.length === 0) return null;

  if (typeof rawFallback === "string") {
    const fallback = rawFallback.trim();
    if (fallback && normalizedModels.includes(fallback)) return fallback;
  }
  return normalizedModels[0] ?? null;
}

/**
 * Resolve the per-model stats key for a provider request. Exact configured
 * models win; otherwise the current group's configured fallback model is used.
 */
export function resolveProviderHealthTestModelForRequest(
  groupTag: string | null | undefined,
  requestedModel: string | null | undefined,
  modelsByGroup: ReadonlyMap<string, string[] | null | undefined>,
  fallbackByGroup?: ReadonlyMap<string, string | null | undefined>
): string | null {
  const model = requestedModel?.trim() ?? "";
  const groups = resolveProviderGroupsWithDefault(groupTag);

  for (const group of groups) {
    const configuredModels = modelsByGroup.get(group) ?? [];
    if (model && configuredModels.includes(model)) return model;
  }

  if (!fallbackByGroup) return null;
  for (const group of groups) {
    const configuredModels = modelsByGroup.get(group) ?? [];
    const fallback = resolveProviderGroupHealthTestModelFallback(
      fallbackByGroup.get(group),
      configuredModels
    );
    if (fallback) return fallback;
  }
  return null;
}
