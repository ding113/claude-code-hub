import { afterEach, describe, expect, test, vi } from "vitest";

import { runLatencyProbeCycle } from "../latency-probe";

describe("vendor-probe/latency-probe", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("probes enabled endpoints and updates latencyMs", async () => {
    const dateNow = vi.spyOn(Date, "now");
    dateNow.mockReturnValueOnce(1000).mockReturnValueOnce(1050);
    dateNow.mockReturnValueOnce(2000).mockReturnValueOnce(2060);

    const store = {
      listEnabledEndpoints: vi.fn(async () => [
        {
          id: 1,
          url: "https://a.example",
          healthCheckEnabled: false,
          healthCheckEndpoint: null,
          healthCheckTimeoutMs: null,
        },
        {
          id: 2,
          url: "https://b.example/",
          healthCheckEnabled: false,
          healthCheckEndpoint: null,
          healthCheckTimeoutMs: null,
        },
      ]),
      updateEndpointLatencyMs: vi.fn(async () => {}),
    };

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(null, { status: 204 });
    });

    const results = await runLatencyProbeCycle({
      store,
      fetchImpl: fetchMock,
      defaultTimeoutMs: 5000,
    });

    expect(results).toEqual([
      expect.objectContaining({ endpointId: 1, ok: true, latencyMs: 50, statusCode: 204 }),
      expect.objectContaining({ endpointId: 2, ok: true, latencyMs: 60, statusCode: 204 }),
    ]);

    expect(store.updateEndpointLatencyMs).toHaveBeenCalledTimes(2);
    expect(store.updateEndpointLatencyMs).toHaveBeenNthCalledWith(1, 1, 50);
    expect(store.updateEndpointLatencyMs).toHaveBeenNthCalledWith(2, 2, 60);
  });

  test("uses healthCheckEndpoint when enabled", async () => {
    const store = {
      listEnabledEndpoints: vi.fn(async () => [
        {
          id: 1,
          url: "https://a.example/api",
          healthCheckEnabled: true,
          healthCheckEndpoint: "/health",
          healthCheckTimeoutMs: 5000,
        },
      ]),
      updateEndpointLatencyMs: vi.fn(async () => {}),
    };

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(null, { status: 200 });
    });

    await runLatencyProbeCycle({
      store,
      fetchImpl: fetchMock,
      defaultTimeoutMs: 5000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://a.example/health");
  });

  test("sets latency to null on timeout", async () => {
    vi.useFakeTimers();

    const store = {
      listEnabledEndpoints: vi.fn(async () => [
        {
          id: 1,
          url: "https://timeout.example",
          healthCheckEnabled: false,
          healthCheckEndpoint: null,
          healthCheckTimeoutMs: null,
        },
      ]),
      updateEndpointLatencyMs: vi.fn(async () => {}),
    };

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            (err as any).name = "AbortError";
            reject(err);
          });
        })
    );

    const promise = runLatencyProbeCycle({
      store,
      fetchImpl: fetchMock,
      defaultTimeoutMs: 50,
    });

    await vi.advanceTimersByTimeAsync(60);
    const results = await promise;

    expect(results).toEqual([
      expect.objectContaining({ endpointId: 1, ok: false, latencyMs: null, statusCode: null }),
    ]);
    expect(store.updateEndpointLatencyMs).toHaveBeenCalledWith(1, null);
  });
});
