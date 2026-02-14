import { describe, expect, test, vi } from "vitest";

describe("provider-endpoints repository - recordProviderEndpointProbeResult", () => {
  test("endpoint 不存在/已删除时应静默忽略（不写 probe log）", async () => {
    vi.resetModules();

    const returningMock = vi.fn(async () => []);
    const whereMock = vi.fn(() => ({ returning: returningMock }));
    const setMock = vi.fn(() => ({ where: whereMock }));
    const updateMock = vi.fn(() => ({ set: setMock }));

    const valuesMock = vi.fn(async () => {});
    const insertMock = vi.fn(() => ({ values: valuesMock }));

    const transactionMock = vi.fn(async (fn: (tx: any) => Promise<void>) => {
      return fn({ update: updateMock, insert: insertMock });
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        transaction: transactionMock,
      },
    }));

    const { recordProviderEndpointProbeResult } = await import("@/repository/provider-endpoints");

    await expect(
      recordProviderEndpointProbeResult({
        endpointId: 123,
        source: "scheduled",
        ok: true,
        statusCode: 200,
        latencyMs: 10,
        errorType: null,
        errorMessage: null,
        probedAt: new Date("2026-01-01T00:00:00.000Z"),
      })
    ).resolves.toBeUndefined();

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(insertMock).not.toHaveBeenCalled();
    expect(valuesMock).not.toHaveBeenCalled();
  });

  test("endpoint 存在时应同时更新 snapshot + 写入 probe log", async () => {
    vi.resetModules();

    const returningMock = vi.fn(async () => [{ id: 123 }]);
    const whereMock = vi.fn(() => ({ returning: returningMock }));
    const setMock = vi.fn(() => ({ where: whereMock }));
    const updateMock = vi.fn(() => ({ set: setMock }));

    const valuesMock = vi.fn(async () => {});
    const insertMock = vi.fn(() => ({ values: valuesMock }));

    const transactionMock = vi.fn(async (fn: (tx: any) => Promise<void>) => {
      return fn({ update: updateMock, insert: insertMock });
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        transaction: transactionMock,
      },
    }));

    const { recordProviderEndpointProbeResult } = await import("@/repository/provider-endpoints");

    await recordProviderEndpointProbeResult({
      endpointId: 123,
      source: "manual",
      ok: false,
      statusCode: 503,
      latencyMs: 999,
      errorType: "http_5xx",
      errorMessage: "HTTP 503",
      probedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(valuesMock).toHaveBeenCalledTimes(1);
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointId: 123,
        source: "manual",
        ok: false,
        statusCode: 503,
        latencyMs: 999,
        errorType: "http_5xx",
        errorMessage: "HTTP 503",
      })
    );
  });
});
