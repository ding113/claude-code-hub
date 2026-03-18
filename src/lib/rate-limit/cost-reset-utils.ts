export function resolveKeyCostResetAt(
  keyCostResetAt: Date | null | undefined,
  userCostResetAt: Date | null | undefined
): Date | null {
  if (!keyCostResetAt && !userCostResetAt) return null;
  if (!keyCostResetAt) return userCostResetAt ?? null;
  if (!userCostResetAt) return keyCostResetAt;
  return keyCostResetAt > userCostResetAt ? keyCostResetAt : userCostResetAt;
}
