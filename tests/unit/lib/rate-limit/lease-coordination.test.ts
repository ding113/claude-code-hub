import { describe, expect, it } from "vitest";
import {
  buildLeaseRefreshLockKey,
  DEFAULT_LEASE_TTL_SECONDS,
  HIGH_CONCURRENCY_MIN_LEASE_TTL_SECONDS,
  HIGH_CONCURRENCY_TOTAL_COST_CACHE_TTL_SECONDS,
  resolveLeaseTtlSeconds,
  resolveTotalCostCacheTtlSeconds,
  TOTAL_COST_CACHE_TTL_SECONDS,
} from "@/lib/rate-limit/lease";

describe("lease coordination helpers", () => {
  it("uses the configured lease TTL outside high-concurrency mode", () => {
    expect(resolveLeaseTtlSeconds(15, false)).toBe(15);
    expect(resolveLeaseTtlSeconds(undefined, false)).toBe(DEFAULT_LEASE_TTL_SECONDS);
    expect(resolveLeaseTtlSeconds(0, false)).toBe(DEFAULT_LEASE_TTL_SECONDS);
    expect(resolveLeaseTtlSeconds(Number.NaN, false)).toBe(DEFAULT_LEASE_TTL_SECONDS);
  });

  it("raises the lease TTL to the floor in high-concurrency mode but never lowers it", () => {
    expect(resolveLeaseTtlSeconds(10, true)).toBe(HIGH_CONCURRENCY_MIN_LEASE_TTL_SECONDS);
    expect(resolveLeaseTtlSeconds(120, true)).toBe(120);
    expect(resolveLeaseTtlSeconds(null, true)).toBe(HIGH_CONCURRENCY_MIN_LEASE_TTL_SECONDS);
  });

  it("resolves the total cost cache TTL by mode", () => {
    expect(resolveTotalCostCacheTtlSeconds(false)).toBe(TOTAL_COST_CACHE_TTL_SECONDS);
    expect(resolveTotalCostCacheTtlSeconds(true)).toBe(
      HIGH_CONCURRENCY_TOTAL_COST_CACHE_TTL_SECONDS
    );
  });

  it("builds entity-scoped refresh lock keys", () => {
    expect(buildLeaseRefreshLockKey("provider", 12)).toBe("lease:refresh_lock:provider:12");
  });
});
