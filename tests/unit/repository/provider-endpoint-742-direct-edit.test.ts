import { describe, expect, test, vi } from "vitest";

describe("provider-endpoints repository - #742 direct edit", () => {
  test("conflict fallback: direct edit should return read-after-write consistent endpoint", async () => {
    vi.resetModules();

    const duplicateKeyError = Object.assign(
      new Error("duplicate key value violates unique constraint"),
      {
        code: "23505",
      }
    );

    const endpointRow = {
      id: 42,
      vendorId: 7,
      providerType: "claude",
      url: "https://next.example.com/v1/messages",
      label: null,
      sortOrder: 0,
      isEnabled: true,
      lastProbedAt: null,
      lastProbeOk: null,
      lastProbeStatusCode: null,
      lastProbeLatencyMs: null,
      lastProbeErrorType: null,
      lastProbeErrorMessage: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      deletedAt: null,
    };

    const updateReturningMock = vi.fn(async () => {
      throw duplicateKeyError;
    });
    const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
    const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
    const updateMock = vi.fn(() => ({ set: updateSetMock }));

    const selectLimitMock = vi.fn(async () => [endpointRow]);
    const selectWhereMock = vi.fn(() => ({ limit: selectLimitMock }));
    const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
    const selectMock = vi.fn(() => ({ from: selectFromMock }));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        update: updateMock,
        select: selectMock,
      },
    }));

    const { updateProviderEndpoint } = await import("@/repository/provider-endpoints");

    await expect(
      updateProviderEndpoint(42, {
        url: "https://next.example.com/v1/messages",
      })
    ).resolves.toEqual(
      expect.objectContaining({
        id: 42,
        url: "https://next.example.com/v1/messages",
      })
    );

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });
});
