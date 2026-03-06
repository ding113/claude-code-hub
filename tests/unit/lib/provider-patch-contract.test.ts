import { describe, expect, it } from "vitest";
import {
  buildProviderBatchApplyUpdates,
  normalizeProviderBatchPatchDraft,
} from "@/lib/provider-patch-contract";

describe("provider-patch-contract - codex service tier", () => {
  it("normalizes codex_service_tier_preference patch draft", () => {
    const result = normalizeProviderBatchPatchDraft({
      codex_service_tier_preference: { set: "priority" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.codex_service_tier_preference).toEqual({
      mode: "set",
      value: "priority",
    });
  });

  it("builds apply updates for codex_service_tier_preference", () => {
    const normalized = normalizeProviderBatchPatchDraft({
      codex_service_tier_preference: { set: "priority" },
    });

    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    const updates = buildProviderBatchApplyUpdates(normalized.data);
    expect(updates.ok).toBe(true);
    if (!updates.ok) return;

    expect(updates.data.codex_service_tier_preference).toBe("priority");
  });
});
