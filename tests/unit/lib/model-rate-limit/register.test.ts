import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registerExtensionStep = vi.fn();

vi.mock("@/app/v1/_lib/proxy/guard-pipeline", () => ({
  registerExtensionStep: (...a: unknown[]) => registerExtensionStep(...a),
}));
vi.mock("@/app/v1/_lib/proxy/model-rate-limit-guard", () => ({
  ModelRateLimitGuard: { name: "modelRateLimit", execute: async () => null },
}));

describe("registerModelRateLimitExtension", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("registers the model guard immediately before the rateLimit anchor", async () => {
    const { registerModelRateLimitExtension } = await import("@/lib/model-rate-limit/register");
    registerModelRateLimitExtension();

    expect(registerExtensionStep).toHaveBeenCalledWith({
      key: "modelRateLimit",
      step: expect.objectContaining({ name: "modelRateLimit" }),
      insertBefore: "rateLimit",
    });
  });
});
