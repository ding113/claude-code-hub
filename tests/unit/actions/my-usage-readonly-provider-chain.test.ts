import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findReadonlyUsageLogsBatchForKey: vi.fn(),
  getTranslations: vi.fn(async () => (key: string) => key),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  resolveSystemTimezone: vi.fn(async () => "UTC"),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/repository/usage-logs", () => ({
  findReadonlyUsageLogsBatchForKey: mocks.findReadonlyUsageLogsBatchForKey,
  findUsageLogsForKeyBatch: vi.fn(),
  findUsageLogsForKeySlim: vi.fn(),
  getDistinctEndpointsForKey: vi.fn(),
  getDistinctModelsForKey: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: mocks.getTranslations,
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: mocks.resolveSystemTimezone,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
  },
}));

describe("getMyUsageLogsBatchFull", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("readonly my-usage 仅对 raw fallback 链路做强脱敏，其它链路保留原有 clientError 可见性", async () => {
    vi.resetModules();
    mocks.getSession.mockResolvedValueOnce({
      user: { id: 1 },
      key: { id: 7, key: "sk-readonly" },
    });

    mocks.findReadonlyUsageLogsBatchForKey.mockResolvedValueOnce({
      logs: [
        {
          id: 101,
          costBreakdown: {
            input: { usd: "0.1" },
          },
          specialSettings: [
            {
              type: "guard_intercept",
              scope: "guard",
              hit: true,
              guard: "sensitive_word",
              action: "block_request",
              statusCode: 403,
              reason: '{"matched":"secret"}',
            },
          ],
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
                clientError: "401 Unauthorized",
                provider: {
                  id: 1,
                  name: "provider-a",
                  statusCode: 401,
                  statusText: "Unauthorized",
                  upstreamBody: "{\"error\":\"unauthorized\"}",
                  upstreamParsed: { error: "unauthorized" },
                },
              },
            },
            {
              id: 2,
              name: "provider-b",
              rawCrossProviderFallbackEnabled: true,
              errorDetails: {
                request: {
                  headers: "authorization: Bearer raw-secret-token",
                  body: "{\"model\":\"gpt-4.1\"}",
                },
                clientError: "raw fallback leaked error",
                provider: {
                  id: 2,
                  name: "provider-b",
                  statusCode: 404,
                  statusText: "Not Found",
                  upstreamBody: "{\"error\":\"missing\"}",
                  upstreamParsed: { error: "missing" },
                },
              },
            },
            {
              id: 3,
              name: "provider-c",
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
    expect(mocks.findReadonlyUsageLogsBatchForKey).toHaveBeenCalledWith(
      expect.objectContaining({
        keyString: "sk-readonly",
        limit: 20,
      })
    );
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
    expect(result.ok && result.data.logs[0]?.providerChain?.[0]?.errorDetails?.clientError).toBe(
      "401 Unauthorized"
    );
    expect(
      result.ok && result.data.logs[0]?.providerChain?.[0]?.errorDetails?.provider?.upstreamBody
    ).toBe("{\"error\":\"unauthorized\"}");
    expect(
      result.ok && result.data.logs[0]?.providerChain?.[1]?.errorDetails?.clientError
    ).toBeUndefined();
    expect(
      result.ok && result.data.logs[0]?.providerChain?.[1]?.errorDetails?.provider?.upstreamBody
    ).toBeUndefined();
    expect(result.ok && result.data.logs[0]?.providerChain?.[2]).toEqual({
      id: 3,
      name: "provider-c",
      errorDetails: null,
    });
    expect(result.ok && result.data.logs[0]?._liveChain).toBeNull();
    expect(result.ok && result.data.logs[0]?.costBreakdown).toBeNull();
    expect(result.ok && result.data.logs[0]?.specialSettings).toEqual([
      expect.objectContaining({
        type: "guard_intercept",
        reason: null,
      }),
    ]);
  });
});
