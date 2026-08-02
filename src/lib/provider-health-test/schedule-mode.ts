import type { HealthTestScheduleMode } from "@/types/system-config";

/**
 * Return whether the scheduler should run SLO-based scheduled-test rebalance.
 * Missing or unknown values stay fail-safe with the historical dynamic mode.
 */
export function shouldRunSloRebalance(mode: HealthTestScheduleMode | null | undefined): boolean {
  return mode !== "always_on";
}
