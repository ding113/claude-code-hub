import type { ProviderChainItem } from "@/types/message";
import { getRetryCount, isHedgeRace } from "./provider-chain-formatter";

/**
 * Determine whether the cost multiplier badge should render
 * in the TABLE CELL (outside the popover trigger).
 *
 * Rules:
 * - Must have a cost badge (multiplier != 1)
 * - Must NOT have retries (retries show badge inside popover)
 * - Must NOT be a hedge race (hedge shows badge inside popover)
 */
export function shouldShowCostBadgeInCell(
  providerChain: ProviderChainItem[] | null | undefined,
  costMultiplier: number | null | undefined
): boolean {
  if (costMultiplier == null || costMultiplier === 1) return false;
  if (!Number.isFinite(costMultiplier)) return false;
  const chain = providerChain ?? [];
  if (chain.length === 0) return true; // no chain = simple request
  if (getRetryCount(chain) > 0) return false; // retries -> badge in popover
  if (isHedgeRace(chain)) return false; // hedge -> badge in popover
  return true;
}
