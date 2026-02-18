import { describe, expect, it } from "vitest";
import {
  buildProviderBatchApplyUpdates,
  hasProviderBatchPatchChanges,
  normalizeProviderBatchPatchDraft,
  prepareProviderBatchApplyUpdates,
  PROVIDER_PATCH_ERROR_CODES,
} from "@/lib/provider-patch-contract";

describe("provider patch contract", () => {
  it("normalizes undefined fields as no_change and omits them from apply payload", () => {
    const normalized = normalizeProviderBatchPatchDraft({});

    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    expect(normalized.data.group_tag.mode).toBe("no_change");
    expect(hasProviderBatchPatchChanges(normalized.data)).toBe(false);

    const applyPayload = buildProviderBatchApplyUpdates(normalized.data);
    expect(applyPayload.ok).toBe(true);
    if (!applyPayload.ok) return;

    expect(applyPayload.data).toEqual({});
  });

  it("serializes set and clear with distinct payload shapes", () => {
    const setResult = prepareProviderBatchApplyUpdates({
      group_tag: { set: "primary" },
      allowed_models: { set: ["claude-3-7-sonnet"] },
    });
    const clearResult = prepareProviderBatchApplyUpdates({
      group_tag: { clear: true },
      allowed_models: { clear: true },
    });

    expect(setResult.ok).toBe(true);
    if (!setResult.ok) return;

    expect(clearResult.ok).toBe(true);
    if (!clearResult.ok) return;

    expect(setResult.data.group_tag).toBe("primary");
    expect(clearResult.data.group_tag).toBeNull();
    expect(setResult.data.allowed_models).toEqual(["claude-3-7-sonnet"]);
    expect(clearResult.data.allowed_models).toBeNull();
  });

  it("maps empty allowed_models set payload to null", () => {
    const result = prepareProviderBatchApplyUpdates({
      allowed_models: { set: [] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.allowed_models).toBeNull();
  });

  it("maps thinking budget clear to inherit", () => {
    const result = prepareProviderBatchApplyUpdates({
      anthropic_thinking_budget_preference: { clear: true },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.anthropic_thinking_budget_preference).toBe("inherit");
  });

  it("rejects conflicting set and clear modes", () => {
    const result = normalizeProviderBatchPatchDraft({
      group_tag: {
        set: "ops",
        clear: true,
      } as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("group_tag");
  });

  it("rejects clear on non-clearable fields", () => {
    const result = normalizeProviderBatchPatchDraft({
      priority: {
        clear: true,
      } as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("priority");
  });

  it("rejects invalid set runtime shape", () => {
    const result = normalizeProviderBatchPatchDraft({
      weight: {
        set: null,
      } as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("weight");
  });

  it("rejects model_redirects arrays", () => {
    const result = normalizeProviderBatchPatchDraft({
      model_redirects: {
        set: ["not-a-record"],
      } as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("model_redirects");
  });

  it("rejects invalid thinking budget string values", () => {
    const result = normalizeProviderBatchPatchDraft({
      anthropic_thinking_budget_preference: {
        set: "abc",
      } as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("anthropic_thinking_budget_preference");
  });

  it("rejects adaptive thinking specific mode with empty models", () => {
    const result = normalizeProviderBatchPatchDraft({
      anthropic_adaptive_thinking: {
        set: {
          effort: "high",
          modelMatchMode: "specific",
          models: [],
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("anthropic_adaptive_thinking");
  });

  it("supports explicit no_change mode", () => {
    const result = normalizeProviderBatchPatchDraft({
      model_redirects: { no_change: true },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.model_redirects.mode).toBe("no_change");
  });

  it("rejects unknown top-level fields", () => {
    const result = normalizeProviderBatchPatchDraft({
      unknown_field: { set: 1 },
    } as never);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("__root__");
  });

  it("rejects non-object draft payloads", () => {
    const result = normalizeProviderBatchPatchDraft(null as never);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("__root__");
  });
});
