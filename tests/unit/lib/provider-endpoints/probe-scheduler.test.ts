type ProbeTarget = {
  id: number;
  url: string;
  vendorId: number;
  lastProbedAt: Date | null;
  lastProbeOk: boolean | null;
  lastProbeErrorType: string | null;
};

type ProbeResult = {
  ok: boolean;
  method: "HEAD" | "GET";
  statusCode: number | null;
  latencyMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
};

function makeEndpoint(id: number, overrides: Partial<ProbeTarget> = {}): ProbeTarget {
  return {
    id,
    url: `https://example.com/${id}`,
    vendorId: overrides.vendorId ?? 1,
    lastProbedAt: overrides.lastProbedAt ?? null,
    lastProbeOk: overrides.lastProbeOk ?? null,
    lastProbeErrorType: overrides.lastProbeErrorType ?? null,
  };
}

function makeOkResult(): ProbeResult {
  return {
    ok: true,
    method: "HEAD",
    statusCode: 200,
    latencyMs: 1,
    errorType: null,
    errorMessage: null,
  };
}

async function flushMicrotasks(times: number = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

let acquireLeaderLockMock: ReturnType<typeof vi.fn>;
let renewLeaderLockMock: ReturnType<typeof vi.fn>;
let releaseLeaderLockMock: ReturnType<typeof vi.fn>;
let findEnabledEndpointsMock: ReturnType<typeof vi.fn>;
let probeByEndpointMock: ReturnType<typeof vi.fn>;

vi.mock("@/lib/provider-endpoints/leader-lock", () => ({
  acquireLeaderLock: (...args: unknown[]) => acquireLeaderLockMock(...args),
  renewLeaderLock: (...args: unknown[]) => renewLeaderLockMock(...args),
  releaseLeaderLock: (...args: unknown[]) => releaseLeaderLockMock(...args),
}));

vi.mock("@/repository", () => ({
  findEnabledProviderEndpointsForProbing: (...args: unknown[]) => findEnabledEndpointsMock(...args),
}));

vi.mock("@/lib/provider-endpoints/probe", () => ({
  probeProviderEndpointAndRecordByEndpoint: (...args: unknown[]) => probeByEndpointMock(...args),
}));

describe("provider-endpoints: probe scheduler", () => {
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("not leader: scheduled probing does nothing", async () => {
    vi.resetModules();
    vi.stubEnv("ENDPOINT_PROBE_INTERVAL_MS", "1000");
    vi.stubEnv("ENDPOINT_PROBE_CYCLE_JITTER_MS", "0");

    acquireLeaderLockMock = vi.fn(async () => null);
    renewLeaderLockMock = vi.fn(async () => false);
    releaseLeaderLockMock = vi.fn(async () => {});

    findEnabledEndpointsMock = vi.fn(async () => [makeEndpoint(1)]);
    probeByEndpointMock = vi.fn(async () => makeOkResult());

    const { startEndpointProbeScheduler, stopEndpointProbeScheduler } = await import(
      "@/lib/provider-endpoints/probe-scheduler"
    );

    startEndpointProbeScheduler();

    await flushMicrotasks();

    expect(acquireLeaderLockMock).toHaveBeenCalled();
    expect(findEnabledEndpointsMock).not.toHaveBeenCalled();
    expect(probeByEndpointMock).not.toHaveBeenCalled();

    stopEndpointProbeScheduler();
  });

  test("concurrency is respected and cycle does not overlap", async () => {
    vi.useFakeTimers();

    vi.resetModules();
    vi.stubEnv("ENDPOINT_PROBE_INTERVAL_MS", "1000");
    vi.stubEnv("ENDPOINT_PROBE_TIMEOUT_MS", "5000");
    vi.stubEnv("ENDPOINT_PROBE_CONCURRENCY", "2");
    vi.stubEnv("ENDPOINT_PROBE_CYCLE_JITTER_MS", "0");
    vi.stubEnv("ENDPOINT_PROBE_LOCK_TTL_MS", "30000");

    acquireLeaderLockMock = vi.fn(async () => ({
      key: "locks:endpoint-probe-scheduler",
      lockId: "test",
      lockType: "memory" as const,
    }));
    renewLeaderLockMock = vi.fn(async () => true);
    releaseLeaderLockMock = vi.fn(async () => {});

    const endpoints = [
      makeEndpoint(1),
      makeEndpoint(2),
      makeEndpoint(3),
      makeEndpoint(4),
      makeEndpoint(5),
    ];
    findEnabledEndpointsMock = vi.fn(async () => endpoints);

    let inFlight = 0;
    let maxInFlight = 0;
    const pending: Array<(res: ProbeResult) => void> = [];

    probeByEndpointMock = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<ProbeResult>((resolve) => {
        pending.push((res) => {
          inFlight -= 1;
          resolve(res);
        });
      });
    });

    const { startEndpointProbeScheduler, stopEndpointProbeScheduler } = await import(
      "@/lib/provider-endpoints/probe-scheduler"
    );

    startEndpointProbeScheduler();

    await flushMicrotasks();

    expect(findEnabledEndpointsMock).toHaveBeenCalledTimes(1);
    expect(probeByEndpointMock).toHaveBeenCalledTimes(2);
    expect(inFlight).toBe(2);
    expect(maxInFlight).toBe(2);

    vi.advanceTimersByTime(2000);
    await flushMicrotasks();

    expect(findEnabledEndpointsMock).toHaveBeenCalledTimes(1);

    while (probeByEndpointMock.mock.calls.length < endpoints.length || inFlight > 0) {
      const next = pending.shift();
      if (!next) {
        break;
      }
      next(makeOkResult());
      await flushMicrotasks(2);
    }

    expect(probeByEndpointMock).toHaveBeenCalledTimes(endpoints.length);
    expect(maxInFlight).toBe(2);

    stopEndpointProbeScheduler();
  });

  describe("dynamic interval calculation", () => {
    test("default interval is 60s - endpoints probed 60s ago should be probed", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T12:01:00Z"));

      vi.resetModules();
      vi.stubEnv("ENDPOINT_PROBE_INTERVAL_MS", "60000");
      vi.stubEnv("ENDPOINT_PROBE_CYCLE_JITTER_MS", "0");

      acquireLeaderLockMock = vi.fn(async () => ({
        key: "locks:endpoint-probe-scheduler",
        lockId: "test",
        lockType: "memory" as const,
      }));
      renewLeaderLockMock = vi.fn(async () => true);
      releaseLeaderLockMock = vi.fn(async () => {});

      // Two endpoints from SAME vendor (multi-endpoint vendor uses base 60s interval)
      // Both probed 61s ago - should be due
      const endpoint = makeEndpoint(1, {
        vendorId: 1,
        lastProbedAt: new Date("2024-01-01T11:59:59Z"), // 61s ago
      });
      const endpoint2 = makeEndpoint(2, {
        vendorId: 1, // Same vendor
        lastProbedAt: new Date("2024-01-01T11:59:59Z"), // 61s ago
      });

      findEnabledEndpointsMock = vi.fn(async () => [endpoint, endpoint2]);
      probeByEndpointMock = vi.fn(async () => makeOkResult());

      const { startEndpointProbeScheduler, stopEndpointProbeScheduler } = await import(
        "@/lib/provider-endpoints/probe-scheduler"
      );

      startEndpointProbeScheduler();
      await flushMicrotasks();

      // Both endpoints should be probed since they're due (61s > 60s interval)
      expect(probeByEndpointMock).toHaveBeenCalledTimes(2);

      stopEndpointProbeScheduler();
    });

    test("single-endpoint vendor uses 10min interval", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T12:05:00Z"));

      vi.resetModules();
      vi.stubEnv("ENDPOINT_PROBE_INTERVAL_MS", "60000");
      vi.stubEnv("ENDPOINT_PROBE_CYCLE_JITTER_MS", "0");

      acquireLeaderLockMock = vi.fn(async () => ({
        key: "locks:endpoint-probe-scheduler",
        lockId: "test",
        lockType: "memory" as const,
      }));
      renewLeaderLockMock = vi.fn(async () => true);
      releaseLeaderLockMock = vi.fn(async () => {});

      // Vendor 1: single endpoint probed 5min ago (should NOT be due - 10min interval)
      // Vendor 2: two endpoints, one probed 30s ago (should NOT be due - 60s interval but recently probed)
      const singleVendorEndpoint = makeEndpoint(1, {
        vendorId: 1,
        lastProbedAt: new Date("2024-01-01T12:00:00Z"), // 5min ago
      });
      const multiVendorEndpoint1 = makeEndpoint(2, {
        vendorId: 2,
        lastProbedAt: new Date("2024-01-01T12:04:30Z"), // 30s ago - NOT due
      });
      const multiVendorEndpoint2 = makeEndpoint(3, {
        vendorId: 2,
        lastProbedAt: new Date("2024-01-01T12:00:00Z"), // 5min ago - should be due
      });

      findEnabledEndpointsMock = vi.fn(async () => [
        singleVendorEndpoint,
        multiVendorEndpoint1,
        multiVendorEndpoint2,
      ]);
      probeByEndpointMock = vi.fn(async () => makeOkResult());

      const { startEndpointProbeScheduler, stopEndpointProbeScheduler } = await import(
        "@/lib/provider-endpoints/probe-scheduler"
      );

      startEndpointProbeScheduler();
      await flushMicrotasks();

      // Only multiVendorEndpoint2 should be probed (5min > 60s, multi-endpoint vendor)
      // singleVendorEndpoint not due (5min < 10min)
      // multiVendorEndpoint1 not due (30s < 60s)
      expect(probeByEndpointMock).toHaveBeenCalledTimes(1);
      expect(probeByEndpointMock.mock.calls[0][0].endpoint.id).toBe(3);

      stopEndpointProbeScheduler();
    });

    test("timeout endpoint uses 10s override interval", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T12:00:15Z"));

      vi.resetModules();
      vi.stubEnv("ENDPOINT_PROBE_INTERVAL_MS", "60000");
      vi.stubEnv("ENDPOINT_PROBE_CYCLE_JITTER_MS", "0");

      acquireLeaderLockMock = vi.fn(async () => ({
        key: "locks:endpoint-probe-scheduler",
        lockId: "test",
        lockType: "memory" as const,
      }));
      renewLeaderLockMock = vi.fn(async () => true);
      releaseLeaderLockMock = vi.fn(async () => {});

      // Endpoint with timeout error 15s ago - should be due (10s override)
      const timeoutEndpoint = makeEndpoint(1, {
        vendorId: 1,
        lastProbedAt: new Date("2024-01-01T12:00:00Z"),
        lastProbeOk: false,
        lastProbeErrorType: "timeout",
      });
      // Normal endpoint from same vendor probed 15s ago - not due (60s interval)
      const normalEndpoint = makeEndpoint(2, {
        vendorId: 1,
        lastProbedAt: new Date("2024-01-01T12:00:00Z"),
        lastProbeOk: true,
      });

      findEnabledEndpointsMock = vi.fn(async () => [timeoutEndpoint, normalEndpoint]);
      probeByEndpointMock = vi.fn(async () => makeOkResult());

      const { startEndpointProbeScheduler, stopEndpointProbeScheduler } = await import(
        "@/lib/provider-endpoints/probe-scheduler"
      );

      startEndpointProbeScheduler();
      await flushMicrotasks();

      // Only timeout endpoint should be probed
      expect(probeByEndpointMock).toHaveBeenCalledTimes(1);
      expect(probeByEndpointMock.mock.calls[0][0].endpoint.id).toBe(1);

      stopEndpointProbeScheduler();
    });

    test("timeout override takes priority over 10min single-vendor interval", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T12:00:15Z"));

      vi.resetModules();
      vi.stubEnv("ENDPOINT_PROBE_INTERVAL_MS", "60000");
      vi.stubEnv("ENDPOINT_PROBE_CYCLE_JITTER_MS", "0");

      acquireLeaderLockMock = vi.fn(async () => ({
        key: "locks:endpoint-probe-scheduler",
        lockId: "test",
        lockType: "memory" as const,
      }));
      renewLeaderLockMock = vi.fn(async () => true);
      releaseLeaderLockMock = vi.fn(async () => {});

      // Single-endpoint vendor with timeout error 15s ago
      // Without timeout, would use 10min interval and not be due
      // With timeout, uses 10s override and IS due
      const timeoutSingleVendor = makeEndpoint(1, {
        vendorId: 1, // only endpoint for this vendor
        lastProbedAt: new Date("2024-01-01T12:00:00Z"),
        lastProbeOk: false,
        lastProbeErrorType: "timeout",
      });

      findEnabledEndpointsMock = vi.fn(async () => [timeoutSingleVendor]);
      probeByEndpointMock = vi.fn(async () => makeOkResult());

      const { startEndpointProbeScheduler, stopEndpointProbeScheduler } = await import(
        "@/lib/provider-endpoints/probe-scheduler"
      );

      startEndpointProbeScheduler();
      await flushMicrotasks();

      // Timeout override should take priority
      expect(probeByEndpointMock).toHaveBeenCalledTimes(1);

      stopEndpointProbeScheduler();
    });

    test("recovered endpoint (lastProbeOk=true) reverts to normal interval", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T12:00:15Z"));

      vi.resetModules();
      vi.stubEnv("ENDPOINT_PROBE_INTERVAL_MS", "60000");
      vi.stubEnv("ENDPOINT_PROBE_CYCLE_JITTER_MS", "0");

      acquireLeaderLockMock = vi.fn(async () => ({
        key: "locks:endpoint-probe-scheduler",
        lockId: "test",
        lockType: "memory" as const,
      }));
      renewLeaderLockMock = vi.fn(async () => true);
      releaseLeaderLockMock = vi.fn(async () => {});

      // Had timeout before but now recovered (lastProbeOk=true) - uses normal interval
      const recoveredEndpoint = makeEndpoint(1, {
        vendorId: 1,
        lastProbedAt: new Date("2024-01-01T12:00:00Z"), // 15s ago
        lastProbeOk: true, // recovered!
        lastProbeErrorType: "timeout", // had timeout before
      });
      // Multi-vendor so 60s base interval applies
      const otherEndpoint = makeEndpoint(2, {
        vendorId: 1,
        lastProbedAt: new Date("2024-01-01T12:00:00Z"),
        lastProbeOk: true,
      });

      findEnabledEndpointsMock = vi.fn(async () => [recoveredEndpoint, otherEndpoint]);
      probeByEndpointMock = vi.fn(async () => makeOkResult());

      const { startEndpointProbeScheduler, stopEndpointProbeScheduler } = await import(
        "@/lib/provider-endpoints/probe-scheduler"
      );

      startEndpointProbeScheduler();
      await flushMicrotasks();

      // Neither should be probed - 15s < 60s and lastProbeOk=true means no timeout override
      expect(probeByEndpointMock).toHaveBeenCalledTimes(0);

      stopEndpointProbeScheduler();
    });

    test("null lastProbedAt is always due for probing", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));

      vi.resetModules();
      vi.stubEnv("ENDPOINT_PROBE_INTERVAL_MS", "60000");
      vi.stubEnv("ENDPOINT_PROBE_CYCLE_JITTER_MS", "0");

      acquireLeaderLockMock = vi.fn(async () => ({
        key: "locks:endpoint-probe-scheduler",
        lockId: "test",
        lockType: "memory" as const,
      }));
      renewLeaderLockMock = vi.fn(async () => true);
      releaseLeaderLockMock = vi.fn(async () => {});

      // Never probed endpoint should always be due
      const neverProbed = makeEndpoint(1, {
        vendorId: 1,
        lastProbedAt: null,
      });

      findEnabledEndpointsMock = vi.fn(async () => [neverProbed]);
      probeByEndpointMock = vi.fn(async () => makeOkResult());

      const { startEndpointProbeScheduler, stopEndpointProbeScheduler } = await import(
        "@/lib/provider-endpoints/probe-scheduler"
      );

      startEndpointProbeScheduler();
      await flushMicrotasks();

      expect(probeByEndpointMock).toHaveBeenCalledTimes(1);

      stopEndpointProbeScheduler();
    });
  });
});
