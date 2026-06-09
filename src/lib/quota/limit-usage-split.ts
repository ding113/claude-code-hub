import type { CostGlobalSplit } from "@/repository/statistics";

/**
 * group-rate-limit (§5.3 / §10): a per-window usage view split into the portion enforced
 * by the mainline global gate (`countedInGlobalUsage`) and the portion routed only to the
 * model-group buckets (`modelGroupOnlyUsage`). `usage` stays the total so existing readers
 * are unaffected; the quota gauge should compare `countedInGlobalUsage` against `limit`,
 * and surface `modelGroupOnlyUsage` only when it is greater than zero.
 */
export type LimitUsageWindow = {
  usage: number;
  limit: number | null;
  countedInGlobalUsage: number;
  modelGroupOnlyUsage: number;
};

export function buildSplitWindow(split: CostGlobalSplit, limit: number | null): LimitUsageWindow {
  const total = split.total;
  const countedInGlobal = Math.min(split.countedInGlobal, total);
  return {
    usage: total,
    limit,
    countedInGlobalUsage: countedInGlobal,
    modelGroupOnlyUsage: Math.max(0, total - countedInGlobal),
  };
}
