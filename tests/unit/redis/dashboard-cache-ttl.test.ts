import { describe, expect, it, vi } from "vitest";

const settingsState = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettingsOnlyCache: () => settingsState.value,
}));

import { resolveDashboardCacheTtlSeconds } from "@/lib/redis/dashboard-cache-ttl";

describe("resolveDashboardCacheTtlSeconds", () => {
  it("uses the default TTL without a settings snapshot or with the mode off", () => {
    settingsState.value = null;
    expect(resolveDashboardCacheTtlSeconds(10, 30)).toBe(10);
    settingsState.value = { enableHighConcurrencyMode: false };
    expect(resolveDashboardCacheTtlSeconds(10, 30)).toBe(10);
  });

  it("uses the high-concurrency TTL when the mode is on", () => {
    settingsState.value = { enableHighConcurrencyMode: true };
    expect(resolveDashboardCacheTtlSeconds(10, 30)).toBe(30);
  });
});
