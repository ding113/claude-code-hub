type ProbeTarget = {
  id: number;
  url: string;
  lastProbedAt: Date | null;
  lastProbeOk: boolean | null;
};

type ProbeResult = {
  ok: boolean;
  method: "HEAD" | "GET";
  statusCode: number | null;
  latencyMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
};

function makeEndpoint(id: number): ProbeTarget {
  return {
    id,
    url: `https://example.com/${id}`,
    lastProbedAt: null,
    lastProbeOk: null,
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
});
