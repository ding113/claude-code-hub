import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("ApiKeyVacuumFilter：重建窗口安全性", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();

    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (globalThis as unknown as { __CCH_API_KEY_VACUUM_FILTER__?: unknown })
      .__CCH_API_KEY_VACUUM_FILTER__;

    for (const k of ["NEXT_RUNTIME", "ENABLE_API_KEY_VACUUM_FILTER"]) {
      originalEnv[k] = process.env[k];
    }
    setEnv({
      NEXT_RUNTIME: "nodejs",
      ENABLE_API_KEY_VACUUM_FILTER: "true",
    });
  });

  afterEach(() => {
    setEnv(originalEnv);
    vi.unstubAllGlobals();
    vi.useRealTimers();
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (globalThis as unknown as { __CCH_API_KEY_VACUUM_FILTER__?: unknown })
      .__CCH_API_KEY_VACUUM_FILTER__;
  });

  test("loadingPromise 存在时应返回 null（不短路）", async () => {
    const [{ apiKeyVacuumFilter }, { VacuumFilter }] = await Promise.all([
      import("@/lib/security/api-key-vacuum-filter"),
      import("@/lib/vacuum-filter/vacuum-filter"),
    ]);

    const vf = new VacuumFilter({
      maxItems: 16,
      fingerprintBits: 32,
      maxKickSteps: 100,
      seed: "unit-test-reloading",
    });
    expect(vf.add("k1")).toBe(true);

    (apiKeyVacuumFilter as unknown as { vf: VacuumFilter }).vf = vf;
    (apiKeyVacuumFilter as unknown as { loadingPromise: Promise<void> | null }).loadingPromise =
      new Promise<void>(() => {});

    expect(apiKeyVacuumFilter.isDefinitelyNotPresent("k1")).toBeNull();
    expect(apiKeyVacuumFilter.isDefinitelyNotPresent("missing")).toBeNull();
  });

  test("ENABLE_API_KEY_VACUUM_FILTER=0：应禁用过滤器（不短路）", async () => {
    setEnv({ ENABLE_API_KEY_VACUUM_FILTER: "0" });
    const { apiKeyVacuumFilter } = await import("@/lib/security/api-key-vacuum-filter");

    expect(apiKeyVacuumFilter.getStats().enabled).toBe(false);
    expect(apiKeyVacuumFilter.isDefinitelyNotPresent("missing")).toBeNull();
  });
});
