import { HIGH_CONCURRENCY_MIN_LEASE_TTL_SECONDS } from "@/lib/rate-limit/quota-lease-constants";

/**
 * 仅用于 UI 警告：DB 刷新频率过低可能带来较高 DB 负载（不阻止保存）。
 */
export function shouldWarnQuotaDbRefreshIntervalTooLow(value: number): boolean {
  return value > 0 && value <= 2;
}

/**
 * 仅用于 UI 警告：DB 刷新频率过高可能导致配额/限额更新延迟（不阻止保存）。
 */
export function shouldWarnQuotaDbRefreshIntervalTooHigh(value: number): boolean {
  return value >= 60;
}

/**
 * 仅用于 UI 警告：租约比例为 0 可能导致租约预算始终为 0（不阻止保存）。
 */
export function shouldWarnQuotaLeasePercentZero(value: number): boolean {
  return value === 0;
}

/**
 * 仅用于 UI 警告：租约 cap 为 0 可能导致每次租约预算为 0（不阻止保存）。
 */
export function shouldWarnQuotaLeaseCapZero(rawValue: string): boolean {
  const trimmed = rawValue.trim();
  if (!trimmed) return false;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return false;
  return parsed === 0;
}

/**
 * 仅用于 UI 提示：高并发模式下，配额 DB 刷新间隔实际不低于下限值。
 * 返回生效的刷新间隔；无需提示时返回 null。
 */
export function getHighConcurrencyEffectiveRefreshInterval(
  value: number,
  highConcurrencyModeEnabled: boolean
): number | null {
  if (!highConcurrencyModeEnabled) return null;
  if (value >= HIGH_CONCURRENCY_MIN_LEASE_TTL_SECONDS) return null;
  return HIGH_CONCURRENCY_MIN_LEASE_TTL_SECONDS;
}
