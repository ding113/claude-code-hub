import { describe, expect, it, vi } from "vitest";
import { selectHedgeAlternative } from "@/app/v1/_lib/proxy/provider-fallback";
import type { Provider } from "@/types/provider";

function provider(id: number, name: string): Provider {
  return { id, name } as Provider;
}

describe("selectHedgeAlternative", () => {
  it("does not use ordinary candidates during a health-only hedge launch", async () => {
    const selectOrdinary = vi.fn(async () => provider(2, "ordinary"));

    const result = await selectHedgeAlternative({
      allowNonSloFallback: false,
      launchedProviderIds: [1],
      failedProviderIds: [1],
      selectHealthSlo: async () => null,
      selectOrdinary,
    });

    expect(result).toEqual({
      provider: null,
      mode: "none",
      excludedProviderIds: [1],
    });
    expect(selectOrdinary).not.toHaveBeenCalled();
  });

  it("continues with the ordinary candidate pool after a failed attempt", async () => {
    const selectOrdinary = vi.fn(async (excludedProviderIds: number[]) => {
      expect(excludedProviderIds).toEqual([1, 3]);
      return provider(2, "ordinary");
    });

    const result = await selectHedgeAlternative({
      allowNonSloFallback: true,
      launchedProviderIds: [1, 1],
      failedProviderIds: [1, 3],
      selectHealthSlo: async () => null,
      selectOrdinary,
    });

    expect(result.provider?.name).toBe("ordinary");
    expect(result.mode).toBe("ordinary");
    expect(result.excludedProviderIds).toEqual([1, 3]);
    expect(selectOrdinary).toHaveBeenCalledOnce();
  });

  it("keeps preferring a health-SLO peer when one exists", async () => {
    const selectOrdinary = vi.fn(async () => provider(3, "ordinary"));

    const result = await selectHedgeAlternative({
      allowNonSloFallback: true,
      launchedProviderIds: [1],
      failedProviderIds: [1],
      selectHealthSlo: async () => provider(2, "health-slo"),
      selectOrdinary,
    });

    expect(result.provider?.name).toBe("health-slo");
    expect(result.mode).toBe("health_slo");
    expect(selectOrdinary).not.toHaveBeenCalled();
  });
});
