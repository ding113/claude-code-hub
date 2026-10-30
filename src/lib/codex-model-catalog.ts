import { matchesAllowedModelRules, normalizeAllowedModelRules } from "@/lib/allowed-model-rules";
import {
  getProviderModelRedirectTarget,
  normalizeProviderModelRedirectRules,
} from "@/lib/provider-model-redirects";
import type { Provider } from "@/types/provider";

export const CODEX_MODEL_CATALOG_MAX_BYTES = 1024 * 1024;
export const CODEX_MODEL_CATALOG_UPSTREAM_MAX_BYTES = 4 * 1024 * 1024;

export type CodexModelInfo = Record<string, unknown> & {
  slug: string;
  display_name: string;
  context_window?: number | null;
  max_context_window?: number | null;
  auto_compact_token_limit?: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCodexModelInfo(value: unknown): value is CodexModelInfo {
  if (!isRecord(value) || !isNonEmptyString(value.slug) || !isNonEmptyString(value.display_name)) {
    return false;
  }
  if (
    !["unified_exec", "default", "local", "shell_command", "disabled"].includes(
      value.shell_type as string
    ) ||
    !["list", "hide", "none"].includes(value.visibility as string) ||
    typeof value.supported_in_api !== "boolean" ||
    typeof value.support_verbosity !== "boolean" ||
    typeof value.priority !== "number" ||
    !Number.isInteger(value.priority) ||
    value.priority < -2147483648 ||
    value.priority > 2147483647 ||
    !isStringArray(value.experimental_supported_tools)
  ) {
    return false;
  }
  const truncation = value.truncation_policy;
  if (
    !isRecord(truncation) ||
    !["bytes", "tokens"].includes(truncation.mode as string) ||
    !isPositiveInteger(truncation.limit)
  ) {
    return false;
  }
  // Effort names are extensible strings in Codex; preserve future upstream values.
  if (
    !Array.isArray(value.supported_reasoning_levels) ||
    !value.supported_reasoning_levels.every(
      (level) =>
        isRecord(level) && isNonEmptyString(level.effort) && typeof level.description === "string"
    )
  ) {
    return false;
  }
  for (const field of ["context_window", "max_context_window", "auto_compact_token_limit"]) {
    if (value[field] != null && !isPositiveInteger(value[field])) return false;
  }
  if (
    typeof value.context_window === "number" &&
    typeof value.max_context_window === "number" &&
    value.context_window > value.max_context_window
  ) {
    return false;
  }
  const percent = value.effective_context_window_percent;
  if (percent !== undefined && (!isPositiveInteger(percent) || percent > 100)) return false;
  for (const field of [
    "description",
    "default_reasoning_level",
    "base_instructions",
    "default_service_tier",
    "comp_hash",
    "auto_review_model_override",
    "model_specialty",
    "multi_agent_reasoning_effort",
    "tool_mode",
    "multi_agent_version",
  ]) {
    if (value[field] != null && typeof value[field] !== "string") return false;
  }
  for (const field of [
    "include_skills_usage_instructions",
    "include_plugin_usage_instructions",
    "include_apps_usage_instructions",
    "supports_reasoning_summary_parameter",
    "supports_image_detail_original",
    "supports_search_tool",
    "supports_experimental_context",
    "use_responses_lite",
    "supports_reasoning_effort_updates",
    "node_repl_auto_review_required",
    "node_repl_disabled",
  ]) {
    if (value[field] !== undefined && typeof value[field] !== "boolean") return false;
  }
  const enums: Array<[string, string[], boolean]> = [
    ["default_reasoning_summary", ["auto", "concise", "detailed", "none"], false],
    ["default_verbosity", ["low", "medium", "high"], true],
    ["apply_patch_tool_type", ["freeform"], true],
    ["web_search_tool_type", ["text", "text_and_image"], false],
  ];
  for (const [field, allowed, nullable] of enums) {
    const option = value[field];
    if (
      option !== undefined &&
      !(nullable && option === null) &&
      !allowed.includes(option as string)
    ) {
      return false;
    }
  }
  if (value.additional_speed_tiers !== undefined && !isStringArray(value.additional_speed_tiers)) {
    return false;
  }
  if (
    value.input_modalities !== undefined &&
    (!isStringArray(value.input_modalities) ||
      !value.input_modalities.every((modality) => ["text", "image", "audio"].includes(modality)))
  ) {
    return false;
  }
  if (
    value.service_tiers !== undefined &&
    (!Array.isArray(value.service_tiers) ||
      !value.service_tiers.every(
        (tier) =>
          isRecord(tier) &&
          typeof tier.id === "string" &&
          typeof tier.name === "string" &&
          typeof tier.description === "string"
      ))
  ) {
    return false;
  }
  for (const field of ["guardian", "available_access_programs", "availability_nux", "upgrade"]) {
    if (value[field] != null && !isRecord(value[field])) return false;
  }
  if (
    isRecord(value.available_access_programs) &&
    !isStringArray(value.available_access_programs.cyber)
  ) {
    return false;
  }
  if (isRecord(value.availability_nux) && typeof value.availability_nux.message !== "string") {
    return false;
  }
  if (
    isRecord(value.upgrade) &&
    (typeof value.upgrade.model !== "string" ||
      typeof value.upgrade.migration_markdown !== "string")
  ) {
    return false;
  }
  if (value.model_messages != null) {
    if (!isRecord(value.model_messages)) return false;
    for (const field of [
      "instructions_template",
      "content_filter_guidance",
      "persistent_instructions",
    ]) {
      if (value.model_messages[field] != null && typeof value.model_messages[field] !== "string") {
        return false;
      }
    }
    for (const field of [
      "tools",
      "approvals",
      "collaboration_modes",
      "auto_review",
      "permissions",
      "multi_agent",
      "token_budget",
      "guardian_v2",
      "confirmation_policies",
    ]) {
      if (value.model_messages[field] != null && !isRecord(value.model_messages[field]))
        return false;
    }
  }
  return (
    typeof value.base_instructions === "string" ||
    (isRecord(value.model_messages) &&
      typeof value.model_messages.instructions_template === "string")
  );
}

/** Keep complete native entries; an ordinary OpenAI model list is not a Codex catalog. */
export function parseCodexModelCatalog(body: unknown): CodexModelInfo[] {
  if (!isRecord(body) || !Array.isArray(body.models)) return [];
  return body.models.filter(isCodexModelInfo).map((model) => structuredClone(model));
}

/** Project only concrete public names onto metadata from an exact upstream model. */
export function projectCodexModelCatalog(
  models: CodexModelInfo[],
  provider: Pick<Provider, "allowedModels" | "modelRedirects">,
  userAllowedModels?: string[]
): CodexModelInfo[] {
  const upstreamModels = new Map(models.map((model) => [model.slug, model]));
  const candidates = new Set(upstreamModels.keys());
  for (const rule of normalizeAllowedModelRules(provider.allowedModels) ?? []) {
    if (rule.matchType === "exact") candidates.add(rule.pattern);
  }
  for (const rule of normalizeProviderModelRedirectRules(provider.modelRedirects) ?? []) {
    if (rule.matchType === "exact") candidates.add(rule.source);
  }
  for (const model of userAllowedModels ?? []) candidates.add(model);
  const userModels = userAllowedModels?.length
    ? new Set(userAllowedModels.map((model) => model.toLowerCase()))
    : null;
  const projected: CodexModelInfo[] = [];
  for (const candidate of candidates) {
    if (!matchesAllowedModelRules(candidate, provider.allowedModels)) continue;
    if (userModels && !userModels.has(candidate.toLowerCase())) continue;
    const target = getProviderModelRedirectTarget(candidate, provider.modelRedirects);
    const upstream = upstreamModels.get(target);
    if (upstream) projected.push({ ...structuredClone(upstream), slug: candidate });
  }
  return projected;
}

function minimumKnown(values: Array<number | null | undefined>): number | undefined {
  const known = values.filter((value): value is number => isPositiveInteger(value));
  return known.length ? Math.min(...known) : undefined;
}

/** Select one complete source per slug, reconciling only its advertised context limits. */
export function mergeCodexModelCatalog(
  sources: Array<{
    provider: Pick<Provider, "id" | "priority">;
    models: CodexModelInfo[];
  }>
): { models: CodexModelInfo[] } {
  const grouped = new Map<string, CodexModelInfo[]>();
  const orderedSources = [...sources].sort(
    (left, right) =>
      left.provider.priority - right.provider.priority || left.provider.id - right.provider.id
  );
  for (const source of orderedSources) {
    for (const model of source.models) {
      const entries = grouped.get(model.slug) ?? [];
      entries.push(model);
      grouped.set(model.slug, entries);
    }
  }
  const models: CodexModelInfo[] = [];
  for (const entries of grouped.values()) {
    const base = structuredClone(entries[0]);
    const context = minimumKnown(
      entries.map((entry) => entry.context_window ?? entry.max_context_window)
    );
    const maximum = minimumKnown(entries.map((entry) => entry.max_context_window));
    if (maximum !== undefined) base.max_context_window = maximum;
    if (context !== undefined) base.context_window = Math.min(context, maximum ?? context);
    const autoCompact = minimumKnown(entries.map((entry) => entry.auto_compact_token_limit));
    if (autoCompact !== undefined) {
      base.auto_compact_token_limit = Math.min(autoCompact, base.context_window ?? autoCompact);
    }
    models.push(base);
  }
  return {
    models: models.sort((left, right) =>
      left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0
    ),
  };
}
