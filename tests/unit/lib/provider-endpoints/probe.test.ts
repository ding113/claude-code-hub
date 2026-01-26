import { afterEach, describe, expect, test, vi } from "vitest";
import type { ProviderEndpoint } from "@/types/provider";

function makeEndpoint(overrides: Partial<ProviderEndpoint>): ProviderEndpoint {
  return {
    id: 1,
    vendorId: 1,
    providerType: "claude",
    url: "https://example.com",
    label: null,
    sortOrder: 0,
    isEnabled: true,
    lastProbedAt: null,
    lastProbeOk: null,
    lastProbeStatusCode: null,
    lastProbeLatencyMs: null,
    lastProbeErrorType: null,
    lastProbeErrorMessage: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("provider-endpoints: probe", () => {
  test("probeEndpointUrl: HEAD 成功时直接返回，不触发 GET", async () => {
    vi.resetModules();

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      trace: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };

    vi.doMock("@/lib/logger", () => ({ logger }));
    vi.doMock("@/repository", () => ({
      findProviderEndpointById: vi.fn(),
      recordProviderEndpointProbeResult: vi.fn(),
      updateProviderEndpointProbeSnapshot: vi.fn(),
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      recordEndpointFailure: vi.fn(async () => {}),
    }));

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return new Response(null, { status: 204 });
      }
      throw new Error("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { probeEndpointUrl } = await import("@/lib/provider-endpoints/probe");
    const result = await probeEndpointUrl("https://example.com", 1234);

    expect(result).toEqual(
      expect.objectContaining({ ok: true, method: "HEAD", statusCode: 204, errorType: null })
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("probeEndpointUrl: HEAD 网络错误时回退 GET", async () => {
    vi.resetModules();

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      trace: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };

    vi.doMock("@/lib/logger", () => ({ logger }));
    vi.doMock("@/repository", () => ({
      findProviderEndpointById: vi.fn(),
      recordProviderEndpointProbeResult: vi.fn(),
      updateProviderEndpointProbeSnapshot: vi.fn(),
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      recordEndpointFailure: vi.fn(async () => {}),
    }));

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        throw new Error("boom");
      }
      if (init?.method === "GET") {
        return new Response(null, { status: 200 });
      }
      throw new Error("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { probeEndpointUrl } = await import("@/lib/provider-endpoints/probe");
    const result = await probeEndpointUrl("https://example.com", 1234);

    expect(result).toEqual(
      expect.objectContaining({ ok: true, method: "GET", statusCode: 200, errorType: null })
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("probeEndpointUrl: 5xx 返回 ok=false 且标注 http_5xx", async () => {
    vi.resetModules();

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      trace: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };

    vi.doMock("@/lib/logger", () => ({ logger }));
    vi.doMock("@/repository", () => ({
      findProviderEndpointById: vi.fn(),
      recordProviderEndpointProbeResult: vi.fn(),
      updateProviderEndpointProbeSnapshot: vi.fn(),
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      recordEndpointFailure: vi.fn(async () => {}),
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 }))
    );

    const { probeEndpointUrl } = await import("@/lib/provider-endpoints/probe");
    const result = await probeEndpointUrl("https://example.com", 1234);

    expect(result.ok).toBe(false);
    expect(result.method).toBe("HEAD");
    expect(result.statusCode).toBe(503);
    expect(result.errorType).toBe("http_5xx");
    expect(result.errorMessage).toBe("HTTP 503");
  });

  test("probeEndpointUrl: 4xx 仍视为 ok=true", async () => {
    vi.resetModules();

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      trace: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };

    vi.doMock("@/lib/logger", () => ({ logger }));
    vi.doMock("@/repository", () => ({
      findProviderEndpointById: vi.fn(),
      recordProviderEndpointProbeResult: vi.fn(),
      updateProviderEndpointProbeSnapshot: vi.fn(),
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      recordEndpointFailure: vi.fn(async () => {}),
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 }))
    );

    const { probeEndpointUrl } = await import("@/lib/provider-endpoints/probe");
    const result = await probeEndpointUrl("https://example.com", 1234);

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(404);
    expect(result.errorType).toBeNull();
  });

  test("probeEndpointUrl: AbortError 归类为 timeout", async () => {
    vi.resetModules();

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      trace: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };

    vi.doMock("@/lib/logger", () => ({ logger }));
    vi.doMock("@/repository", () => ({
      findProviderEndpointById: vi.fn(),
      recordProviderEndpointProbeResult: vi.fn(),
      updateProviderEndpointProbeSnapshot: vi.fn(),
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      recordEndpointFailure: vi.fn(async () => {}),
    }));

    const fetchMock = vi.fn(async () => {
      const err = new Error("");
      err.name = "AbortError";
      throw err;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { probeEndpointUrl } = await import("@/lib/provider-endpoints/probe");
    const result = await probeEndpointUrl("https://example.com", 1);

    expect(result.ok).toBe(false);
    expect(result.method).toBe("GET");
    expect(result.statusCode).toBeNull();
    expect(result.errorType).toBe("timeout");
    expect(result.errorMessage).toBe("timeout");
  });

  test("probeProviderEndpointAndRecord: endpoint 不存在时返回 null", async () => {
    vi.resetModules();

    const recordMock = vi.fn(async () => {});
    const snapshotMock = vi.fn(async () => {});
    const findMock = vi.fn(async () => null);

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      trace: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };

    const recordFailureMock = vi.fn(async () => {});

    vi.doMock("@/lib/logger", () => ({ logger }));
    vi.doMock("@/repository", () => ({
      findProviderEndpointById: findMock,
      recordProviderEndpointProbeResult: recordMock,
      updateProviderEndpointProbeSnapshot: snapshotMock,
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      recordEndpointFailure: recordFailureMock,
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 }))
    );

    const { probeProviderEndpointAndRecord } = await import("@/lib/provider-endpoints/probe");
    const result = await probeProviderEndpointAndRecord({ endpointId: 123, source: "manual" });

    expect(result).toBeNull();
    expect(recordMock).not.toHaveBeenCalled();
    expect(snapshotMock).not.toHaveBeenCalled();
    expect(recordFailureMock).not.toHaveBeenCalled();
  });

  test("probeProviderEndpointAndRecord: 记录入库字段包含 source/ok/statusCode/latency/probedAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    vi.resetModules();

    const recordMock = vi.fn(async () => {});
    const snapshotMock = vi.fn(async () => {});
    const findMock = vi.fn(async () => makeEndpoint({ id: 123, url: "https://example.com" }));

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      trace: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };

    const recordFailureMock = vi.fn(async () => {});

    vi.doMock("@/lib/logger", () => ({ logger }));
    vi.doMock("@/repository", () => ({
      findProviderEndpointById: findMock,
      recordProviderEndpointProbeResult: recordMock,
      updateProviderEndpointProbeSnapshot: snapshotMock,
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      recordEndpointFailure: recordFailureMock,
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 }))
    );

    const { probeProviderEndpointAndRecord } = await import("@/lib/provider-endpoints/probe");
    const result = await probeProviderEndpointAndRecord({
      endpointId: 123,
      source: "manual",
      timeoutMs: 1111,
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, statusCode: 200, errorType: null }));

    expect(recordMock).toHaveBeenCalledTimes(1);
    const payload = recordMock.mock.calls[0]?.[0];
    expect(payload).toEqual(
      expect.objectContaining({
        endpointId: 123,
        source: "manual",
        ok: true,
        statusCode: 200,
        errorType: null,
        errorMessage: null,
      })
    );

    const probedAt = (payload as { probedAt: Date }).probedAt;
    expect(probedAt).toBeInstanceOf(Date);
    expect(probedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");

    expect(snapshotMock).not.toHaveBeenCalled();
    expect(recordFailureMock).not.toHaveBeenCalled();
  });

  test("probeProviderEndpointAndRecord: scheduled 成功总是写入探测日志记录", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:30.000Z"));

    vi.resetModules();

    const recordMock = vi.fn(async () => {});
    const recordFailureMock = vi.fn(async () => {});

    const endpoint = makeEndpoint({
      id: 1,
      url: "https://example.com",
      lastProbeOk: true,
      lastProbedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    vi.doMock("@/lib/logger", () => ({
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        trace: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      },
    }));
    vi.doMock("@/repository", () => ({
      findProviderEndpointById: vi.fn(async () => endpoint),
      recordProviderEndpointProbeResult: recordMock,
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      recordEndpointFailure: recordFailureMock,
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 }))
    );

    const { probeProviderEndpointAndRecord } = await import("@/lib/provider-endpoints/probe");
    const result = await probeProviderEndpointAndRecord({ endpointId: 1, source: "scheduled" });

    expect(result).toEqual(expect.objectContaining({ ok: true, statusCode: 200 }));
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordFailureMock).not.toHaveBeenCalled();
  });

  test("probeProviderEndpointAndRecord: 失败会计入端点熔断计数（scheduled 与 manual）", async () => {
    vi.resetModules();

    const recordMock = vi.fn(async () => {});
    const recordFailureMock = vi.fn(async () => {});

    vi.doMock("@/lib/logger", () => ({
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        trace: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      },
    }));
    vi.doMock("@/repository", () => ({
      findProviderEndpointById: vi.fn(async () =>
        makeEndpoint({ id: 123, url: "https://example.com" })
      ),
      recordProviderEndpointProbeResult: recordMock,
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      recordEndpointFailure: recordFailureMock,
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 }))
    );

    const { probeProviderEndpointAndRecord } = await import("@/lib/provider-endpoints/probe");

    await probeProviderEndpointAndRecord({ endpointId: 123, source: "scheduled" });
    await probeProviderEndpointAndRecord({ endpointId: 123, source: "manual" });

    expect(recordFailureMock).toHaveBeenCalledTimes(2);
    expect(recordMock).toHaveBeenCalledTimes(2);
  });
});
