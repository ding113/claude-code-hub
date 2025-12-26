import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

const findAllLatestPricesV2RepositoryMock = vi.fn();
const createModelPriceV2RepositoryMock = vi.fn();
const findModelPriceV2ByIdRepositoryMock = vi.fn();
const deleteModelPriceV2ByIdRepositoryMock = vi.fn();

vi.mock("@/repository/model-price-v2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/model-price-v2")>();
  return {
    ...actual,
    findAllLatestPricesV2: findAllLatestPricesV2RepositoryMock,
    createModelPriceV2: createModelPriceV2RepositoryMock,
    findModelPriceV2ById: findModelPriceV2ByIdRepositoryMock,
    deleteModelPriceV2ById: deleteModelPriceV2ByIdRepositoryMock,
  };
});

const upsertRemoteConfigSyncRepositoryMock = vi.fn();
vi.mock("@/repository/remote-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/remote-config")>();
  return {
    ...actual,
    upsertRemoteConfigSync: upsertRemoteConfigSyncRepositoryMock,
  };
});

const syncPricesMock = vi.fn();
vi.mock("@/lib/remote-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/remote-config")>();
  return {
    ...actual,
    RemoteConfigSyncService: vi.fn().mockImplementation(() => ({
      syncPrices: syncPricesMock,
    })),
  };
});

describe("model-prices-v2 (actions)", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    revalidatePathMock.mockReset();

    findAllLatestPricesV2RepositoryMock.mockReset();
    createModelPriceV2RepositoryMock.mockReset();
    findModelPriceV2ByIdRepositoryMock.mockReset();
    deleteModelPriceV2ByIdRepositoryMock.mockReset();

    upsertRemoteConfigSyncRepositoryMock.mockReset();
    syncPricesMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("getModelPricesV2Paginated returns PERMISSION error for non-admin", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "user" } });

    const { getModelPricesV2Paginated } = await import("@/actions/model-prices-v2");
    const result = await getModelPricesV2Paginated({ page: 1, pageSize: 10 });

    expect(result.ok).toBe(false);
  });

  test("getModelPricesV2Paginated paginates latest prices", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });

    findAllLatestPricesV2RepositoryMock.mockResolvedValue([
      {
        id: 1,
        modelName: "a",
        priceData: {},
        source: "remote",
        isUserOverride: false,
        remoteVersion: "v1",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      },
      {
        id: 2,
        modelName: "b",
        priceData: {},
        source: "remote",
        isUserOverride: false,
        remoteVersion: "v1",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      },
      {
        id: 3,
        modelName: "c",
        priceData: {},
        source: "remote",
        isUserOverride: false,
        remoteVersion: "v1",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      },
    ]);

    const { getModelPricesV2Paginated } = await import("@/actions/model-prices-v2");
    const result = await getModelPricesV2Paginated({ page: 1, pageSize: 2 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.total).toBe(3);
      expect(result.data.totalPages).toBe(2);
      expect(result.data.data.map((p) => p.modelName)).toEqual(["a", "b"]);
    }
  });

  test("syncPricesFromRemote creates new records for changed models", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });

    syncPricesMock.mockResolvedValue({
      ok: true,
      source: "cdn",
      remoteVersion: "v2",
      data: {
        metadata: { version: "v2" },
        prices: {
          "gpt-4o": { input_cost_per_token: 2 },
        },
      },
    });

    findAllLatestPricesV2RepositoryMock.mockResolvedValue([
      {
        id: 1,
        modelName: "gpt-4o",
        priceData: { input_cost_per_token: 1 },
        source: "remote",
        isUserOverride: false,
        remoteVersion: "v1",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      },
    ]);

    createModelPriceV2RepositoryMock.mockResolvedValue({
      id: 2,
      modelName: "gpt-4o",
      priceData: { input_cost_per_token: 2 },
      source: "remote",
      isUserOverride: false,
      remoteVersion: "v2",
      createdAt: new Date("2024-01-02T00:00:00.000Z"),
      updatedAt: new Date("2024-01-02T00:00:00.000Z"),
    });

    upsertRemoteConfigSyncRepositoryMock.mockResolvedValue({
      id: 1,
      configKey: "prices-override",
      remoteVersion: "v2",
      lastAttemptAt: null,
      lastSyncedAt: null,
      lastErrorMessage: null,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    });

    const { syncPricesFromRemote } = await import("@/actions/model-prices-v2");
    const result = await syncPricesFromRemote();

    expect(createModelPriceV2RepositoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: "gpt-4o",
        source: "remote",
        remoteVersion: "v2",
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.remoteVersion).toBe("v2");
      expect(result.data.updated).toContain("gpt-4o");
    }
  });

  test("restoreModelPriceToRemote creates a remote record for the model", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });

    findModelPriceV2ByIdRepositoryMock.mockResolvedValue({
      id: 9,
      modelName: "gpt-4o",
      priceData: { input_cost_per_token: 123 },
      source: "user",
      isUserOverride: true,
      remoteVersion: null,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    });

    syncPricesMock.mockResolvedValue({
      ok: true,
      source: "cdn",
      remoteVersion: "v2",
      data: {
        metadata: { version: "v2" },
        prices: {
          "gpt-4o": { input_cost_per_token: 2 },
        },
      },
    });

    createModelPriceV2RepositoryMock.mockResolvedValue({
      id: 10,
      modelName: "gpt-4o",
      priceData: { input_cost_per_token: 2 },
      source: "remote",
      isUserOverride: false,
      remoteVersion: "v2",
      createdAt: new Date("2024-01-02T00:00:00.000Z"),
      updatedAt: new Date("2024-01-02T00:00:00.000Z"),
    });

    const { restoreModelPriceToRemote } = await import("@/actions/model-prices-v2");
    const result = await restoreModelPriceToRemote(9);

    expect(createModelPriceV2RepositoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: "gpt-4o",
        source: "remote",
        remoteVersion: "v2",
      })
    );
    expect(result.ok).toBe(true);
  });

  test("createModelPriceV2 creates a user override record", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });

    createModelPriceV2RepositoryMock.mockResolvedValue({
      id: 1,
      modelName: "gpt-4o",
      priceData: { input_cost_per_token: 123 },
      source: "user",
      isUserOverride: true,
      remoteVersion: null,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    });

    const { createModelPriceV2 } = await import("@/actions/model-prices-v2");
    const result = await createModelPriceV2({
      modelName: "gpt-4o",
      priceData: { input_cost_per_token: 123 },
    });

    expect(createModelPriceV2RepositoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: "gpt-4o",
        source: "user",
        isUserOverride: true,
        remoteVersion: null,
      })
    );
    expect(result.ok).toBe(true);
  });

  test("updateModelPriceV2 creates a new user override record for the model", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });

    findModelPriceV2ByIdRepositoryMock.mockResolvedValue({
      id: 9,
      modelName: "gpt-4o",
      priceData: { input_cost_per_token: 1 },
      source: "remote",
      isUserOverride: false,
      remoteVersion: "v1",
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    });

    createModelPriceV2RepositoryMock.mockResolvedValue({
      id: 10,
      modelName: "gpt-4o",
      priceData: { input_cost_per_token: 999 },
      source: "user",
      isUserOverride: true,
      remoteVersion: null,
      createdAt: new Date("2024-01-02T00:00:00.000Z"),
      updatedAt: new Date("2024-01-02T00:00:00.000Z"),
    });

    const { updateModelPriceV2 } = await import("@/actions/model-prices-v2");
    const result = await updateModelPriceV2(9, { priceData: { input_cost_per_token: 999 } });

    expect(createModelPriceV2RepositoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: "gpt-4o",
        source: "user",
        isUserOverride: true,
      })
    );
    expect(result.ok).toBe(true);
  });

  test("deleteModelPriceV2 deletes the record", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });

    deleteModelPriceV2ByIdRepositoryMock.mockResolvedValue(true);

    const { deleteModelPriceV2 } = await import("@/actions/model-prices-v2");
    const result = await deleteModelPriceV2(1);

    expect(deleteModelPriceV2ByIdRepositoryMock).toHaveBeenCalledWith(1);
    expect(result.ok).toBe(true);
  });
});
