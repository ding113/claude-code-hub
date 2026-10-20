import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsMock = vi.hoisted(() => ({
  current: {
    enableHighConcurrencyMode: false,
    streamGateMode: "enforce" as const,
    affinityIgnoreClientSessionId: true,
    replayEnabled: true,
    replayCacheTtlMinutes: 30,
    cacheEffectivenessEnabled: true,
  },
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: vi.fn(async () => settingsMock.current),
}));

describe("proxy runtime high-concurrency Redis retention", () => {
  beforeEach(() => {
    vi.resetModules();
    settingsMock.current.enableHighConcurrencyMode = false;
  });

  it("keeps the normal retention when high-concurrency mode is disabled", async () => {
    const { getProxyRuntimeSettings, resolveRedisRetentionTtlSeconds } = await import(
      "@/lib/system-settings/proxy-runtime"
    );

    await getProxyRuntimeSettings();

    expect(resolveRedisRetentionTtlSeconds(2_592_000)).toBe(2_592_000);
  });

  it("caps long retention at one day when high-concurrency mode is enabled", async () => {
    settingsMock.current.enableHighConcurrencyMode = true;
    const { getProxyRuntimeSettings, resolveRedisRetentionTtlSeconds } = await import(
      "@/lib/system-settings/proxy-runtime"
    );

    await getProxyRuntimeSettings();

    expect(resolveRedisRetentionTtlSeconds(2_592_000)).toBe(86_400);
    expect(resolveRedisRetentionTtlSeconds(300)).toBe(300);
  });
});
