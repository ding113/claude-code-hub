import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider, ProviderEndpoint } from "@/types/provider";

const findAllProvidersFreshMock = vi.hoisted(() => vi.fn<[], Promise<Provider[]>>());

vi.mock("@/repository/provider", () => ({
  findAllProvidersFresh: findAllProvidersFreshMock,
}));

const findProviderEndpointsByVendorIdsMock = vi.hoisted(() =>
  vi.fn<[vendorIds: number[]], Promise<ProviderEndpoint[]>>()
);

vi.mock("@/repository/provider-endpoint", () => ({
  findProviderEndpointsByVendorIds: findProviderEndpointsByVendorIdsMock,
}));

const createProviderEndpointProbeEventMock = vi.hoisted(() => vi.fn());
const deleteProviderEndpointProbeEventsOlderThanMock = vi.hoisted(() => vi.fn());

vi.mock("@/repository/provider-endpoint-probe-event", () => ({
  createProviderEndpointProbeEvent: createProviderEndpointProbeEventMock,
  deleteProviderEndpointProbeEventsOlderThan: deleteProviderEndpointProbeEventsOlderThanMock,
}));

const executeProviderTestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/provider-testing/test-service", () => ({
  executeProviderTest: executeProviderTestMock,
}));

const recordEndpointSuccessMock = vi.hoisted(() => vi.fn());
const recordEndpointFailureMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  recordEndpointSuccess: recordEndpointSuccessMock,
  recordEndpointFailure: recordEndpointFailureMock,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

describe("endpoint-probe-scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const state = globalThis as unknown as {
      __CCH_ENDPOINT_PROBE_CURSOR__?: number;
      __CCH_ENDPOINT_PROBE_INTERVAL_ID__?: ReturnType<typeof setInterval> | null;
      __CCH_ENDPOINT_PROBE_CLEANUP_INTERVAL_ID__?: ReturnType<typeof setInterval> | null;
    };

    state.__CCH_ENDPOINT_PROBE_CURSOR__ = 0;
    state.__CCH_ENDPOINT_PROBE_INTERVAL_ID__ = null;
    state.__CCH_ENDPOINT_PROBE_CLEANUP_INTERVAL_ID__ = null;

    process.env.ENABLE_ENDPOINT_PROBING = "true";
    process.env.ENDPOINT_PROBE_MAX_PER_CYCLE = "10";
    process.env.ENDPOINT_PROBE_CONCURRENCY = "2";
    process.env.ENDPOINT_PROBE_TIMEOUT_MS = "5000";
    process.env.ENDPOINT_PROBE_RETENTION_DAYS = "7";
  });

  test("runEndpointProbeCycleOnce: success probes record success and event", async () => {
    vi.resetModules();

    findAllProvidersFreshMock.mockResolvedValue([
      {
        id: 1,
        name: "p1",
        url: "https://provider.example",
        key: "sk-test",
        isEnabled: true,
        vendorId: 10,
        providerType: "claude",
        priority: 0,
      } as unknown as Provider,
    ]);

    findProviderEndpointsByVendorIdsMock.mockResolvedValue([
      {
        id: 100,
        vendorId: 10,
        providerType: "claude",
        baseUrl: "https://endpoint.example",
        isEnabled: true,
        priority: 0,
        weight: 1,
      } as unknown as ProviderEndpoint,
    ]);

    executeProviderTestMock.mockResolvedValue({
      success: true,
      latencyMs: 123,
      httpStatusCode: 200,
    } as unknown);

    createProviderEndpointProbeEventMock.mockResolvedValue({ id: 1 });

    const { runEndpointProbeCycleOnce } = await import("@/lib/endpoint-probe-scheduler");

    await runEndpointProbeCycleOnce();

    expect(executeProviderTestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerUrl: "https://endpoint.example",
        apiKey: "sk-test",
        providerType: "claude",
        timeoutMs: 5000,
      })
    );

    expect(recordEndpointSuccessMock).toHaveBeenCalledWith(100);
    expect(recordEndpointFailureMock).not.toHaveBeenCalled();

    expect(createProviderEndpointProbeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointId: 100,
        source: "active_probe",
        result: "success",
        statusCode: 200,
        latencyMs: 123,
      })
    );
  });

  test("runEndpointProbeCycleOnce: failure probes record failure and event", async () => {
    vi.resetModules();

    findAllProvidersFreshMock.mockResolvedValue([
      {
        id: 1,
        name: "p1",
        url: "https://provider.example",
        key: "sk-test",
        isEnabled: true,
        vendorId: 10,
        providerType: "claude",
        priority: 0,
      } as unknown as Provider,
    ]);

    findProviderEndpointsByVendorIdsMock.mockResolvedValue([
      {
        id: 200,
        vendorId: 10,
        providerType: "claude",
        baseUrl: "https://endpoint.example",
        isEnabled: true,
        priority: 0,
        weight: 1,
      } as unknown as ProviderEndpoint,
    ]);

    executeProviderTestMock.mockResolvedValue({
      success: false,
      latencyMs: 5010,
      errorType: "timeout",
      errorMessage: "Request timed out",
    } as unknown);

    createProviderEndpointProbeEventMock.mockResolvedValue({ id: 1 });

    const { runEndpointProbeCycleOnce } = await import("@/lib/endpoint-probe-scheduler");

    await runEndpointProbeCycleOnce();

    expect(recordEndpointFailureMock).toHaveBeenCalledTimes(1);
    const error = recordEndpointFailureMock.mock.calls[0]?.[1];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("timeout");
    expect((error as Error).message).toBe("Request timed out");

    expect(createProviderEndpointProbeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointId: 200,
        source: "active_probe",
        result: "fail",
        statusCode: null,
        latencyMs: 5010,
        errorType: "timeout",
        errorMessage: "Request timed out",
      })
    );
  });

  test("cleanupEndpointProbeEventsOnce: calls delete with retention days", async () => {
    vi.resetModules();

    deleteProviderEndpointProbeEventsOlderThanMock.mockResolvedValue(12);

    const { cleanupEndpointProbeEventsOnce } = await import("@/lib/endpoint-probe-scheduler");

    const deleted = await cleanupEndpointProbeEventsOnce();

    expect(deleteProviderEndpointProbeEventsOlderThanMock).toHaveBeenCalledWith({ days: 7 });
    expect(deleted).toBe(12);
  });
});
