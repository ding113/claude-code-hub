export function shouldWarnQuotaDbRefreshIntervalTooLow(value: number): boolean {
  return value > 0 && value <= 2;
}

export function shouldWarnQuotaDbRefreshIntervalTooHigh(value: number): boolean {
  return value >= 60;
}

export function shouldWarnQuotaLeasePercentZero(value: number): boolean {
  return value === 0;
}

export function shouldWarnQuotaLeaseCapZero(rawValue: string): boolean {
  const trimmed = rawValue.trim();
  if (!trimmed) return false;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return false;
  return parsed === 0;
}
