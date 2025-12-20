/**
 * Limit helpers for determining unlimited quotas and formatting limit values
 */

/**
 * Check if a limit value represents "unlimited"
 * null, undefined, 0, or negative values are considered unlimited
 */
export function isUnlimited(limit: number | null | undefined): boolean {
  return limit == null || limit <= 0;
}

/**
 * Format a limit value for display
 * @param limit - The limit value
 * @param formatter - Function to format the value (e.g., currency formatter)
 * @param unlimitedText - Text to display when unlimited
 */
export function formatLimit(
  limit: number | null | undefined,
  formatter: (value: number) => string,
  unlimitedText: string
): string {
  if (isUnlimited(limit)) return unlimitedText;
  return formatter(limit!);
}

/**
 * Calculate usage percentage
 * Returns null when the limit is unlimited
 */
export function calculateUsagePercent(
  current: number,
  limit: number | null | undefined
): number | null {
  if (isUnlimited(limit)) return null;
  return Math.min((current / limit!) * 100, 100);
}
