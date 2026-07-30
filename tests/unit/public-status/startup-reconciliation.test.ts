import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReconcilePublicStatusSiteTitleProjection = vi.hoisted(() => vi.fn());
const mockWarn = vi.hoisted(() => vi.fn());

vi.mock("@/lib/public-status/config-publisher", () => ({
  reconcilePublicStatusSiteTitleProjection: mockReconcilePublicStatusSiteTitleProjection,
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: mockWarn },
}));

describe("public-status startup reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stays silent when the site-title projection is current", async () => {
    mockReconcilePublicStatusSiteTitleProjection.mockResolvedValue(true);
    const { reconcilePublicStatusSiteTitleAtStartup } = await import(
      "@/lib/public-status/startup-reconciliation"
    );

    await reconcilePublicStatusSiteTitleAtStartup();

    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("warns without blocking startup when Redis cannot store the projection", async () => {
    mockReconcilePublicStatusSiteTitleProjection.mockResolvedValue(false);
    const { reconcilePublicStatusSiteTitleAtStartup } = await import(
      "@/lib/public-status/startup-reconciliation"
    );

    await expect(reconcilePublicStatusSiteTitleAtStartup()).resolves.toBeUndefined();

    expect(mockWarn).toHaveBeenCalledWith(
      "[Instrumentation] Public status site title reconciliation deferred",
      { reason: "redis-projection-unavailable" }
    );
  });

  it("warns without blocking startup when reconciliation throws", async () => {
    mockReconcilePublicStatusSiteTitleProjection.mockRejectedValue(new Error("redis unavailable"));
    const { reconcilePublicStatusSiteTitleAtStartup } = await import(
      "@/lib/public-status/startup-reconciliation"
    );

    await expect(reconcilePublicStatusSiteTitleAtStartup()).resolves.toBeUndefined();

    expect(mockWarn).toHaveBeenCalledWith(
      "[Instrumentation] Public status site title reconciliation failed",
      { error: "redis unavailable" }
    );
  });
});
