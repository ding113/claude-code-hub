import type { Provider } from "@/types/provider";

export type HedgeAlternativeSelection = {
  provider: Provider | null;
  mode: "health_slo" | "ordinary" | "none";
  excludedProviderIds: number[];
};

/**
 * Select the next provider for streaming hedge/fallback handling.
 *
 * A hedge threshold may only launch a health-SLO peer while another attempt is
 * still running. After an attempt has failed and ordinary fallback is allowed,
 * the selector must continue through the normal candidate pool instead of
 * treating the absence of an SLO peer as terminal.
 */
export async function selectHedgeAlternative(input: {
  allowNonSloFallback: boolean;
  launchedProviderIds: Iterable<number>;
  failedProviderIds: Iterable<number>;
  selectHealthSlo: (excludeProviderIds: number[]) => Promise<Provider | null>;
  selectOrdinary: (excludeProviderIds: number[]) => Promise<Provider | null>;
}): Promise<HedgeAlternativeSelection> {
  const launchedProviderIds = [...new Set(input.launchedProviderIds)];
  const healthSloProvider = await input.selectHealthSlo(launchedProviderIds);
  if (healthSloProvider) {
    return {
      provider: healthSloProvider,
      mode: "health_slo",
      excludedProviderIds: launchedProviderIds,
    };
  }

  if (!input.allowNonSloFallback) {
    return {
      provider: null,
      mode: "none",
      excludedProviderIds: launchedProviderIds,
    };
  }

  const excludedProviderIds = [...new Set([...launchedProviderIds, ...input.failedProviderIds])];
  const ordinaryProvider = await input.selectOrdinary(excludedProviderIds);
  return {
    provider: ordinaryProvider,
    mode: ordinaryProvider ? "ordinary" : "none",
    excludedProviderIds,
  };
}
