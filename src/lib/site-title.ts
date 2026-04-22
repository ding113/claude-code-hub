export const DEFAULT_SITE_TITLE = "Claude Code Hub";

export function normalizeSiteTitle(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveSiteTitle(...values: unknown[]): string {
  for (const value of values) {
    const normalized = normalizeSiteTitle(value);
    if (normalized) {
      return normalized;
    }
  }

  return DEFAULT_SITE_TITLE;
}
