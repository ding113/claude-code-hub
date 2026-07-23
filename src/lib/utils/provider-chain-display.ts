import type { ProviderChainItem } from "@/types/message";
import type { RoutingTraceV1 } from "@/types/routing-trace";
import { getRetryCount, isHedgeRace } from "./provider-chain-formatter";

/**
 * Determine whether the cost multiplier badge should render
 * in the TABLE CELL (outside the popover trigger).
 *
 * Rules:
 * - Must have a cost badge (multiplier != 1)
 * - Discovery requests keep the final winner's badge visible even when
 *   other candidates were tried
 * - Legacy retries still keep the badge inside the popover
 * - Must NOT be a hedge race (hedge shows badge inside popover)
 */
export function shouldShowCostBadgeInCell(
  providerChain: ProviderChainItem[] | null | undefined,
  costMultiplier: number | null | undefined,
  routingTrace?: RoutingTraceV1 | null
): boolean {
  if (costMultiplier == null || costMultiplier === 1) return false;
  if (!Number.isFinite(costMultiplier)) return false;
  const chain = providerChain ?? [];
  if (isHedgeRace(chain)) return false; // hedge -> badge in popover
  if (routingTrace?.mode === "discovery") {
    return chain.some(
      (item) =>
        (item.reason === "request_success" ||
          item.reason === "retry_success" ||
          item.reason === "hedge_winner") &&
        item.statusCode != null
    );
  }
  if (chain.length === 0) return true; // no chain = simple request
  if (getRetryCount(chain) > 0) return false; // retries -> badge in popover
  return true;
}
