import type { Provider } from "@/types/provider";

export function normalizeCostMultiplierCorrection(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function applyCostMultiplierCorrection(
  costMultiplier: number | null | undefined,
  correction: unknown
): number {
  const base = Number.isFinite(costMultiplier) ? Number(costMultiplier) : 1;
  const adjusted = base + normalizeCostMultiplierCorrection(correction);
  return Math.max(0, Math.round((adjusted + Number.EPSILON) * 10_000) / 10_000);
}

export function applyCostMultiplierCorrectionToProvider<T extends Pick<Provider, "costMultiplier">>(
  provider: T,
  correction: unknown
): T {
  const nextCostMultiplier = applyCostMultiplierCorrection(provider.costMultiplier, correction);
  if (nextCostMultiplier === provider.costMultiplier) {
    return provider;
  }

  return {
    ...provider,
    costMultiplier: nextCostMultiplier,
  };
}
