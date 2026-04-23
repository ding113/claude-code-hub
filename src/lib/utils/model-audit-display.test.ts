import { describe, expect, it } from "vitest";
import { resolveModelAuditDisplay } from "./model-audit-display";

describe("resolveModelAuditDisplay", () => {
  it("same-model, no redirect, no mismatch: single display line", () => {
    const r = resolveModelAuditDisplay({
      originalModel: "claude-opus-4-7",
      model: "claude-opus-4-7",
      actualResponseModel: "claude-opus-4-7",
      billingModelSource: "redirected",
    });
    expect(r.primaryBillingModel).toBe("claude-opus-4-7");
    expect(r.hasRedirect).toBe(false);
    expect(r.hasActualMismatch).toBe(false);
    expect(r.secondaryActualModel).toBeNull();
    expect(r.dialogShowsSplitFields).toBe(false);
    expect(r.effectiveRequestModel).toBe("claude-opus-4-7");
  });

  it("redirect only (originalModel != model, actualResponseModel == model): no mismatch line", () => {
    const r = resolveModelAuditDisplay({
      originalModel: "claude-opus-4-5",
      model: "claude-opus-4-7",
      actualResponseModel: "claude-opus-4-7",
      billingModelSource: "original",
    });
    expect(r.primaryBillingModel).toBe("claude-opus-4-5"); // billingModelSource=original
    expect(r.hasRedirect).toBe(true);
    expect(r.hasActualMismatch).toBe(false);
    expect(r.secondaryActualModel).toBeNull();
    expect(r.dialogShowsSplitFields).toBe(false);
    expect(r.effectiveRequestModel).toBe("claude-opus-4-7");
  });

  it("mismatch only (no redirect): renders secondary line and split fields", () => {
    const r = resolveModelAuditDisplay({
      originalModel: "gpt-4.1",
      model: "gpt-4.1",
      actualResponseModel: "gpt-4.1-2025-04-14",
      billingModelSource: "redirected",
    });
    expect(r.primaryBillingModel).toBe("gpt-4.1");
    expect(r.hasRedirect).toBe(false);
    expect(r.hasActualMismatch).toBe(true);
    expect(r.secondaryActualModel).toBe("gpt-4.1-2025-04-14");
    expect(r.dialogShowsSplitFields).toBe(true);
    expect(r.effectiveRequestModel).toBe("gpt-4.1");
  });

  it("triple-difference (originalModel -> model -> actualResponseModel): redirect and mismatch both shown", () => {
    const r = resolveModelAuditDisplay({
      originalModel: "gemini-pro",
      model: "gemini-2.5-flash",
      actualResponseModel: "gemini-2.5-flash-lite",
      billingModelSource: "redirected",
    });
    expect(r.primaryBillingModel).toBe("gemini-2.5-flash"); // billingModelSource=redirected
    expect(r.hasRedirect).toBe(true);
    expect(r.hasActualMismatch).toBe(true);
    expect(r.secondaryActualModel).toBe("gemini-2.5-flash-lite");
    expect(r.dialogShowsSplitFields).toBe(true);
    expect(r.effectiveRequestModel).toBe("gemini-2.5-flash");
  });

  it("compares actualResponseModel against effectiveRequestModel (model), not originalModel", () => {
    // mismatch must be computed from `model` — if response happens to equal originalModel but
    // was redirected to a different model, that's still a mismatch vs the forwarded model.
    const r = resolveModelAuditDisplay({
      originalModel: "gpt-4.1",
      model: "gpt-4.1-mini",
      actualResponseModel: "gpt-4.1",
      billingModelSource: "redirected",
    });
    expect(r.hasActualMismatch).toBe(true);
    expect(r.secondaryActualModel).toBe("gpt-4.1");
    expect(r.effectiveRequestModel).toBe("gpt-4.1-mini");
  });

  it("null actualResponseModel: no mismatch, no secondary line (preserves redirect UI)", () => {
    const r = resolveModelAuditDisplay({
      originalModel: "a",
      model: "b",
      actualResponseModel: null,
      billingModelSource: "original",
    });
    expect(r.hasRedirect).toBe(true);
    expect(r.hasActualMismatch).toBe(false);
    expect(r.secondaryActualModel).toBeNull();
    expect(r.dialogShowsSplitFields).toBe(false);
  });

  it("all-null inputs: returns nullable fields without throwing", () => {
    const r = resolveModelAuditDisplay({
      originalModel: null,
      model: null,
      actualResponseModel: null,
      billingModelSource: null,
    });
    expect(r.primaryBillingModel).toBeNull();
    expect(r.hasRedirect).toBe(false);
    expect(r.hasActualMismatch).toBe(false);
    expect(r.effectiveRequestModel).toBeNull();
  });

  it("falls back to model when billingModelSource is undefined", () => {
    const r = resolveModelAuditDisplay({
      originalModel: "orig",
      model: "effective",
      actualResponseModel: "effective",
      billingModelSource: undefined,
    });
    // default path (non-original) -> model
    expect(r.primaryBillingModel).toBe("effective");
  });
});
