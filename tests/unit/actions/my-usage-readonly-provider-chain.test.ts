import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUsageLogsBatch: vi.fn(),
  getTranslations: vi.fn(async () => (key: string) => key),
  loggerError: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/repository/usage-logs", () => ({
  findUsageLogsBatch: mocks.findUsageLogsBatch,
  findUsageLogsForKeyBatch: vi.fn(),
  findUsageLogsForKeySlim: vi.fn(),
  getDistinctEndpointsForKey: vi.fn(),
  getDistinctModelsForKey: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: mocks.getTranslations,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: mocks.loggerError,
  },
}));

describe("getMyUsageLogsBatchFull", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scrubs request details from providerChain for readonly my-usage responses", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { id: 1 },
      key: { id: 7, key: "sk-readonly" },
    });

    mocks.findUsageLogsBatch.mockResolvedValueOnce({
      logs: [
        {
          id: 101,
          providerChain: [
            {
              id: 1,
              name: "provider-a",
              errorDetails: {
                request: {
                  headers: "authorization: Bearer secret-token",
                  body: "{}",
                },
                response: {
                  statusCode: 500,
                },
              },
            },
            {
              id: 2,
              name: "provider-b",
              errorDetails: null,
            },
          ],
          _liveChain: {
            chain: [
              {
                id: 3,
                name: "live-provider",
                errorDetails: {
                  request: {
                    headers: "x-api-key: live-secret",
                  },
                },
              },
            ],
            phase: "provider",
            updatedAt: 123,
          },
        },
      ],
      nextCursor: null,
      hasMore: false,
    });

    const { getMyUsageLogsBatchFull } = await import("@/actions/my-usage");
    const result = await getMyUsageLogsBatchFull({ limit: 20 });

    expect(mocks.getSession).toHaveBeenCalledWith({ allowReadOnlyAccess: true });
    expect(mocks.findUsageLogsBatch).toHaveBeenCalledWith({ keyId: 7, limit: 20 });
    expect(result).toMatchObject({
      ok: true,
      data: {
        hasMore: false,
      },
    });
    const scrubbedProviderErrorDetails =
      result.ok && result.data.logs[0]?.providerChain?.[0]?.errorDetails;
    expect(scrubbedProviderErrorDetails && "request" in scrubbedProviderErrorDetails).toBe(false);
    expect(result.ok && result.data.logs[0]?.providerChain?.[0]?.errorDetails?.response).toEqual({
      statusCode: 500,
    });
    expect(result.ok && result.data.logs[0]?.providerChain?.[1]).toEqual({
      id: 2,
      name: "provider-b",
      errorDetails: null,
    });
    const scrubbedLiveChainErrorDetails =
      result.ok && result.data.logs[0]?._liveChain?.chain[0]?.errorDetails;
    expect(scrubbedLiveChainErrorDetails && "request" in scrubbedLiveChainErrorDetails).toBe(false);
  });
});
