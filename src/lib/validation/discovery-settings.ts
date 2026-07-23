export const DISCOVERY_SETTINGS_INVALID_ERROR_CODE = "DISCOVERY_SETTINGS_INVALID";
export const DISCOVERY_WINDOW_INVALID_ERROR_CODE = "DISCOVERY_WINDOW_INVALID";

export const DISCOVERY_FIELD_LIMITS = {
  discoveryConcurrency: [2, 32],
  maxDiscoveryRounds: [1, 32],
  discoverySlaMs: [1, 300_000],
  stickySlaMs: [1, 600_000],
  racingTotalTimeoutMs: [1, 3_600_000],
  stickyTimeoutCooldownMs: [1, 86_400_000],
} as const;

export type DiscoverySettingField = keyof typeof DISCOVERY_FIELD_LIMITS;

export function isDiscoverySettingField(value: unknown): value is DiscoverySettingField {
  return typeof value === "string" && value in DISCOVERY_FIELD_LIMITS;
}

export function getDiscoveryValidationErrorCode(
  issues: ReadonlyArray<{ message: string; path: readonly PropertyKey[] }>
): string | undefined {
  if (issues.some((issue) => issue.message === DISCOVERY_WINDOW_INVALID_ERROR_CODE)) {
    return DISCOVERY_WINDOW_INVALID_ERROR_CODE;
  }
  return issues.some((issue) => isDiscoverySettingField(issue.path[0]))
    ? DISCOVERY_SETTINGS_INVALID_ERROR_CODE
    : undefined;
}
