import { afterEach, describe, expect, test, vi } from "vitest";

import { runBalanceCheckCycle } from "../balance-checker";

describe("vendor-balance/balance-checker", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("updates balance and records check (above threshold)", async () => {
    const store = {
      listBalanceCheckTargets: vi.fn(async () => [
        {
          vendorKeyId: 1,
          vendorId: 10,
          endpointId: 100,
          providerType: "codex" as const,
          baseUrl: "https://api.example/",
          apiKey: "test-key",
          balanceCheckEndpoint: "/v1/usage",
          balanceCheckJsonpath: "$.remaining_credits",
          lowThresholdUsd: 10,
        },
      ]),
      recordBalanceCheck: vi.fn(async () => {}),
      updateVendorKeyBalance: vi.fn(async () => {}),
      disableVendorKey: vi.fn(async () => {}),
    };

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ remaining_credits: 12.34 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const results = await runBalanceCheckCycle({ store, fetchImpl: fetchMock, timeoutMs: 5000 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example/v1/usage");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      })
    );

    expect(store.updateVendorKeyBalance).toHaveBeenCalledWith(1, 12.34);
    expect(store.disableVendorKey).not.toHaveBeenCalled();
    expect(store.recordBalanceCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorKeyId: 1,
        vendorId: 10,
        endpointId: 100,
        isSuccess: true,
        statusCode: 200,
        balanceUsd: 12.34,
        errorMessage: null,
      })
    );

    expect(results).toEqual([
      expect.objectContaining({ vendorKeyId: 1, ok: true, balanceUsd: 12.34, disabled: false }),
    ]);
  });

  test("disables key when balance below threshold", async () => {
    const store = {
      listBalanceCheckTargets: vi.fn(async () => [
        {
          vendorKeyId: 1,
          vendorId: 10,
          endpointId: 100,
          providerType: "codex" as const,
          baseUrl: "https://api.example",
          apiKey: "test-key",
          balanceCheckEndpoint: "/v1/usage",
          balanceCheckJsonpath: "$.remaining_credits",
          lowThresholdUsd: 10,
        },
      ]),
      recordBalanceCheck: vi.fn(async () => {}),
      updateVendorKeyBalance: vi.fn(async () => {}),
      disableVendorKey: vi.fn(async () => {}),
    };

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ remaining_credits: 2 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const results = await runBalanceCheckCycle({ store, fetchImpl: fetchMock, timeoutMs: 5000 });

    expect(store.updateVendorKeyBalance).toHaveBeenCalledWith(1, 2);
    expect(store.disableVendorKey).toHaveBeenCalledWith(1);
    expect(results).toEqual([
      expect.objectContaining({ vendorKeyId: 1, ok: true, balanceUsd: 2, disabled: true }),
    ]);
  });

  test("records failure when JSONPath extraction fails", async () => {
    const store = {
      listBalanceCheckTargets: vi.fn(async () => [
        {
          vendorKeyId: 1,
          vendorId: 10,
          endpointId: 100,
          providerType: "codex" as const,
          baseUrl: "https://api.example",
          apiKey: "test-key",
          balanceCheckEndpoint: "/v1/usage",
          balanceCheckJsonpath: "$.missing",
          lowThresholdUsd: 10,
        },
      ]),
      recordBalanceCheck: vi.fn(async () => {}),
      updateVendorKeyBalance: vi.fn(async () => {}),
      disableVendorKey: vi.fn(async () => {}),
    };

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ remaining_credits: 12.34 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const results = await runBalanceCheckCycle({ store, fetchImpl: fetchMock, timeoutMs: 5000 });

    expect(store.updateVendorKeyBalance).not.toHaveBeenCalled();
    expect(store.disableVendorKey).not.toHaveBeenCalled();
    expect(store.recordBalanceCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorKeyId: 1,
        isSuccess: false,
        statusCode: 200,
        balanceUsd: null,
      })
    );
    expect(results).toEqual([
      expect.objectContaining({ vendorKeyId: 1, ok: false, balanceUsd: null, disabled: false }),
    ]);
  });

  test("records failure on non-2xx response", async () => {
    const store = {
      listBalanceCheckTargets: vi.fn(async () => [
        {
          vendorKeyId: 1,
          vendorId: 10,
          endpointId: 100,
          providerType: "codex" as const,
          baseUrl: "https://api.example",
          apiKey: "test-key",
          balanceCheckEndpoint: "/v1/usage",
          balanceCheckJsonpath: "$.remaining_credits",
          lowThresholdUsd: 10,
        },
      ]),
      recordBalanceCheck: vi.fn(async () => {}),
      updateVendorKeyBalance: vi.fn(async () => {}),
      disableVendorKey: vi.fn(async () => {}),
    };

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ error: "bad" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    });

    const results = await runBalanceCheckCycle({ store, fetchImpl: fetchMock, timeoutMs: 5000 });

    expect(store.updateVendorKeyBalance).not.toHaveBeenCalled();
    expect(store.disableVendorKey).not.toHaveBeenCalled();
    expect(store.recordBalanceCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorKeyId: 1,
        isSuccess: false,
        statusCode: 500,
        balanceUsd: null,
      })
    );
    expect(results).toEqual([
      expect.objectContaining({ vendorKeyId: 1, ok: false, balanceUsd: null, disabled: false }),
    ]);
  });
});
