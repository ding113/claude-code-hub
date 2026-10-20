export const REPLAY_CACHE_TTL_MINUTES_DEFAULT = 30;
export const REPLAY_CACHE_TTL_MINUTES_MIN = 5;
export const REPLAY_CACHE_TTL_MINUTES_MAX = 120;
export const REPLAY_CACHE_TTL_INVALID_ERROR_CODE = "REPLAY_CACHE_TTL_INVALID";

export function getReplayCacheTtlValidationErrorCode(
  issues: ReadonlyArray<{ message: string; path: readonly PropertyKey[] }>
): string | undefined {
  return issues.some(
    (issue) =>
      issue.path[0] === "replayCacheTtlMinutes" ||
      issue.message === REPLAY_CACHE_TTL_INVALID_ERROR_CODE
  )
    ? REPLAY_CACHE_TTL_INVALID_ERROR_CODE
    : undefined;
}
