function resolveLaterResetAt(
  primaryResetAt: Date | null | undefined,
  secondaryResetAt: Date | null | undefined
): Date | null {
  if (!primaryResetAt && !secondaryResetAt) return null;
  if (!primaryResetAt) return secondaryResetAt ?? null;
  if (!secondaryResetAt) return primaryResetAt;
  return secondaryResetAt > primaryResetAt ? secondaryResetAt : primaryResetAt;
}

export function resolveKeyCostResetAt(
  keyCostResetAt: Date | null | undefined,
  userCostResetAt: Date | null | undefined
): Date | null {
  return resolveLaterResetAt(userCostResetAt, keyCostResetAt);
}

export function resolveUser5hCostResetAt(
  userCostResetAt: Date | null | undefined,
  limit5hCostResetAt: Date | null | undefined
): Date | null {
  return resolveLaterResetAt(userCostResetAt, limit5hCostResetAt);
}

export function clipStartByResetAt(start: Date, resetAt: Date | null | undefined): Date {
  return resetAt instanceof Date && resetAt > start ? resetAt : start;
}
