import type {
  ProviderBatchApplyUpdates,
  ProviderBatchPatch,
  ProviderBatchPatchDraft,
  ProviderBatchPatchField,
  ProviderPatchDraftInput,
  ProviderPatchOperation,
} from "@/types/provider";

export const PROVIDER_PATCH_ERROR_CODES = {
  INVALID_PATCH_SHAPE: "INVALID_PATCH_SHAPE",
} as const;

export type ProviderPatchErrorCode =
  (typeof PROVIDER_PATCH_ERROR_CODES)[keyof typeof PROVIDER_PATCH_ERROR_CODES];

interface ProviderPatchError {
  code: ProviderPatchErrorCode;
  field: ProviderBatchPatchField | "__root__";
  message: string;
}

type ProviderPatchResult<T> = { ok: true; data: T } | { ok: false; error: ProviderPatchError };

const PATCH_INPUT_KEYS = new Set(["set", "clear", "no_change"]);
const PATCH_FIELDS: ProviderBatchPatchField[] = [
  "is_enabled",
  "priority",
  "weight",
  "cost_multiplier",
  "group_tag",
  "model_redirects",
  "allowed_models",
  "anthropic_thinking_budget_preference",
  "anthropic_adaptive_thinking",
];
const PATCH_FIELD_SET = new Set(PATCH_FIELDS);

const CLEARABLE_FIELDS: Record<ProviderBatchPatchField, boolean> = {
  is_enabled: false,
  priority: false,
  weight: false,
  cost_multiplier: false,
  group_tag: true,
  model_redirects: true,
  allowed_models: true,
  anthropic_thinking_budget_preference: true,
  anthropic_adaptive_thinking: true,
};

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value) || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([key, entry]) => typeof key === "string" && typeof entry === "string"
  );
}

function isAdaptiveThinkingConfig(
  value: unknown
): value is NonNullable<ProviderBatchApplyUpdates["anthropic_adaptive_thinking"]> {
  if (!isRecord(value)) {
    return false;
  }

  const effortValues = new Set(["low", "medium", "high", "max"]);
  const modeValues = new Set(["specific", "all"]);

  if (typeof value.effort !== "string" || !effortValues.has(value.effort)) {
    return false;
  }

  if (typeof value.modelMatchMode !== "string" || !modeValues.has(value.modelMatchMode)) {
    return false;
  }

  if (!Array.isArray(value.models) || !value.models.every((model) => typeof model === "string")) {
    return false;
  }

  if (value.modelMatchMode === "specific" && value.models.length === 0) {
    return false;
  }

  return true;
}

function isThinkingBudgetPreference(value: unknown): boolean {
  if (value === "inherit") {
    return true;
  }

  if (typeof value !== "string") {
    return false;
  }

  if (!/^\d+$/.test(value)) {
    return false;
  }

  const parsed = Number.parseInt(value, 10);
  return parsed >= 1024 && parsed <= 32000;
}

function isValidSetValue(field: ProviderBatchPatchField, value: unknown): boolean {
  switch (field) {
    case "is_enabled":
      return typeof value === "boolean";
    case "priority":
    case "weight":
    case "cost_multiplier":
      return typeof value === "number" && Number.isFinite(value);
    case "group_tag":
      return typeof value === "string";
    case "anthropic_thinking_budget_preference":
      return isThinkingBudgetPreference(value);
    case "model_redirects":
      return isStringRecord(value);
    case "allowed_models":
      return Array.isArray(value) && value.every((model) => typeof model === "string");
    case "anthropic_adaptive_thinking":
      return isAdaptiveThinkingConfig(value);
    default:
      return false;
  }
}

function createNoChangePatch<T>(): ProviderPatchOperation<T> {
  return { mode: "no_change" };
}

function createInvalidPatchShapeError(
  field: ProviderBatchPatchField,
  message: string
): ProviderPatchResult<never> {
  return {
    ok: false,
    error: {
      code: PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE,
      field,
      message,
    },
  };
}

function createInvalidRootPatchShapeError(message: string): ProviderPatchResult<never> {
  return {
    ok: false,
    error: {
      code: PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE,
      field: "__root__",
      message,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePatchField<T>(
  field: ProviderBatchPatchField,
  input: ProviderPatchDraftInput<T>
): ProviderPatchResult<ProviderPatchOperation<T>> {
  if (input === undefined) {
    return { ok: true, data: createNoChangePatch() };
  }

  if (!isRecord(input)) {
    return createInvalidPatchShapeError(field, "Patch input must be an object");
  }

  const unknownKeys = Object.keys(input).filter((key) => !PATCH_INPUT_KEYS.has(key));
  if (unknownKeys.length > 0) {
    return createInvalidPatchShapeError(
      field,
      `Patch input contains unknown keys: ${unknownKeys.join(",")}`
    );
  }

  const hasSet = Object.hasOwn(input, "set");
  const hasClear = input.clear === true;
  const hasNoChange = input.no_change === true;
  const modeCount = [hasSet, hasClear, hasNoChange].filter(Boolean).length;

  if (modeCount !== 1) {
    return createInvalidPatchShapeError(field, "Patch input must choose exactly one mode");
  }

  if (hasSet) {
    if (input.set === undefined) {
      return createInvalidPatchShapeError(field, "set mode requires a defined value");
    }

    if (!isValidSetValue(field, input.set)) {
      return createInvalidPatchShapeError(field, "set mode value is invalid for this field");
    }

    return { ok: true, data: { mode: "set", value: input.set as T } };
  }

  if (hasNoChange) {
    return { ok: true, data: createNoChangePatch() };
  }

  if (!CLEARABLE_FIELDS[field]) {
    return createInvalidPatchShapeError(field, "clear mode is not supported for this field");
  }

  return { ok: true, data: { mode: "clear" } };
}

export function normalizeProviderBatchPatchDraft(
  draft: unknown
): ProviderPatchResult<ProviderBatchPatch> {
  if (!isRecord(draft) || Array.isArray(draft)) {
    return createInvalidRootPatchShapeError("Patch draft must be an object");
  }

  const unknownFields = Object.keys(draft).filter(
    (key) => !PATCH_FIELD_SET.has(key as ProviderBatchPatchField)
  );
  if (unknownFields.length > 0) {
    return createInvalidRootPatchShapeError(
      `Patch draft contains unknown fields: ${unknownFields.join(",")}`
    );
  }

  const typedDraft = draft as ProviderBatchPatchDraft;

  const isEnabled = normalizePatchField("is_enabled", typedDraft.is_enabled);
  if (!isEnabled.ok) return isEnabled;

  const priority = normalizePatchField("priority", typedDraft.priority);
  if (!priority.ok) return priority;

  const weight = normalizePatchField("weight", typedDraft.weight);
  if (!weight.ok) return weight;

  const costMultiplier = normalizePatchField("cost_multiplier", typedDraft.cost_multiplier);
  if (!costMultiplier.ok) return costMultiplier;

  const groupTag = normalizePatchField("group_tag", typedDraft.group_tag);
  if (!groupTag.ok) return groupTag;

  const modelRedirects = normalizePatchField("model_redirects", typedDraft.model_redirects);
  if (!modelRedirects.ok) return modelRedirects;

  const allowedModels = normalizePatchField("allowed_models", typedDraft.allowed_models);
  if (!allowedModels.ok) return allowedModels;

  const thinkingBudget = normalizePatchField(
    "anthropic_thinking_budget_preference",
    typedDraft.anthropic_thinking_budget_preference
  );
  if (!thinkingBudget.ok) return thinkingBudget;

  const adaptiveThinking = normalizePatchField(
    "anthropic_adaptive_thinking",
    typedDraft.anthropic_adaptive_thinking
  );
  if (!adaptiveThinking.ok) return adaptiveThinking;

  return {
    ok: true,
    data: {
      is_enabled: isEnabled.data,
      priority: priority.data,
      weight: weight.data,
      cost_multiplier: costMultiplier.data,
      group_tag: groupTag.data,
      model_redirects: modelRedirects.data,
      allowed_models: allowedModels.data,
      anthropic_thinking_budget_preference: thinkingBudget.data,
      anthropic_adaptive_thinking: adaptiveThinking.data,
    },
  };
}

function applyPatchField<T>(
  updates: ProviderBatchApplyUpdates,
  field: ProviderBatchPatchField,
  patch: ProviderPatchOperation<T>
): ProviderPatchResult<void> {
  if (patch.mode === "no_change") {
    return { ok: true, data: undefined };
  }

  if (patch.mode === "set") {
    switch (field) {
      case "is_enabled":
        updates.is_enabled = patch.value as ProviderBatchApplyUpdates["is_enabled"];
        return { ok: true, data: undefined };
      case "priority":
        updates.priority = patch.value as ProviderBatchApplyUpdates["priority"];
        return { ok: true, data: undefined };
      case "weight":
        updates.weight = patch.value as ProviderBatchApplyUpdates["weight"];
        return { ok: true, data: undefined };
      case "cost_multiplier":
        updates.cost_multiplier = patch.value as ProviderBatchApplyUpdates["cost_multiplier"];
        return { ok: true, data: undefined };
      case "group_tag":
        updates.group_tag = patch.value as ProviderBatchApplyUpdates["group_tag"];
        return { ok: true, data: undefined };
      case "model_redirects":
        updates.model_redirects = patch.value as ProviderBatchApplyUpdates["model_redirects"];
        return { ok: true, data: undefined };
      case "allowed_models":
        updates.allowed_models =
          (patch.value as string[]).length > 0
            ? (patch.value as ProviderBatchApplyUpdates["allowed_models"])
            : null;
        return { ok: true, data: undefined };
      case "anthropic_thinking_budget_preference":
        updates.anthropic_thinking_budget_preference =
          patch.value as ProviderBatchApplyUpdates["anthropic_thinking_budget_preference"];
        return { ok: true, data: undefined };
      case "anthropic_adaptive_thinking":
        updates.anthropic_adaptive_thinking =
          patch.value as ProviderBatchApplyUpdates["anthropic_adaptive_thinking"];
        return { ok: true, data: undefined };
      default:
        return createInvalidPatchShapeError(field, "Unsupported patch field");
    }
  }

  switch (field) {
    case "group_tag":
      updates.group_tag = null;
      return { ok: true, data: undefined };
    case "model_redirects":
      updates.model_redirects = null;
      return { ok: true, data: undefined };
    case "allowed_models":
      updates.allowed_models = null;
      return { ok: true, data: undefined };
    case "anthropic_thinking_budget_preference":
      updates.anthropic_thinking_budget_preference = "inherit";
      return { ok: true, data: undefined };
    case "anthropic_adaptive_thinking":
      updates.anthropic_adaptive_thinking = null;
      return { ok: true, data: undefined };
    default:
      return createInvalidPatchShapeError(field, "clear mode is not supported for this field");
  }
}

export function buildProviderBatchApplyUpdates(
  patch: ProviderBatchPatch
): ProviderPatchResult<ProviderBatchApplyUpdates> {
  const updates: ProviderBatchApplyUpdates = {};

  const operations: Array<[ProviderBatchPatchField, ProviderPatchOperation<unknown>]> = [
    ["is_enabled", patch.is_enabled],
    ["priority", patch.priority],
    ["weight", patch.weight],
    ["cost_multiplier", patch.cost_multiplier],
    ["group_tag", patch.group_tag],
    ["model_redirects", patch.model_redirects],
    ["allowed_models", patch.allowed_models],
    ["anthropic_thinking_budget_preference", patch.anthropic_thinking_budget_preference],
    ["anthropic_adaptive_thinking", patch.anthropic_adaptive_thinking],
  ];

  for (const [field, operation] of operations) {
    const applyResult = applyPatchField(updates, field, operation);
    if (!applyResult.ok) {
      return applyResult;
    }
  }

  return { ok: true, data: updates };
}

export function hasProviderBatchPatchChanges(patch: ProviderBatchPatch): boolean {
  return (
    patch.is_enabled.mode !== "no_change" ||
    patch.priority.mode !== "no_change" ||
    patch.weight.mode !== "no_change" ||
    patch.cost_multiplier.mode !== "no_change" ||
    patch.group_tag.mode !== "no_change" ||
    patch.model_redirects.mode !== "no_change" ||
    patch.allowed_models.mode !== "no_change" ||
    patch.anthropic_thinking_budget_preference.mode !== "no_change" ||
    patch.anthropic_adaptive_thinking.mode !== "no_change"
  );
}

export function prepareProviderBatchApplyUpdates(
  draft: unknown
): ProviderPatchResult<ProviderBatchApplyUpdates> {
  const normalized = normalizeProviderBatchPatchDraft(draft);
  if (!normalized.ok) {
    return normalized;
  }

  return buildProviderBatchApplyUpdates(normalized.data);
}
