import { beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn();

const getSessionDetailsCacheMock = vi.fn();
const setSessionDetailsCacheMock = vi.fn();

const getSessionRequestCountMock = vi.fn();
const getSessionRequestBodyMock = vi.fn();
const getSessionMessagesMock = vi.fn();
const getSessionResponseMock = vi.fn();
const getSessionRequestHeadersMock = vi.fn();
const getSessionResponseHeadersMock = vi.fn();
const getSessionClientRequestMetaMock = vi.fn();
const getSessionUpstreamRequestMetaMock = vi.fn();
const getSessionUpstreamResponseMetaMock = vi.fn();
const getSessionSpecialSettingsMock = vi.fn();

const aggregateSessionStatsMock = vi.fn();
const findAdjacentRequestSequencesMock = vi.fn();
const findMessageRequestAuditBySessionIdAndSequenceMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/lib/cache/session-cache", () => ({
  getActiveSessionsCache: vi.fn(() => null),
  setActiveSessionsCache: vi.fn(),
  getSessionDetailsCache: getSessionDetailsCacheMock,
  setSessionDetailsCache: setSessionDetailsCacheMock,
  clearActiveSessionsCache: vi.fn(),
  clearSessionDetailsCache: vi.fn(),
  clearAllSessionsCache: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    getSessionRequestCount: getSessionRequestCountMock,
    getSessionRequestBody: getSessionRequestBodyMock,
    getSessionMessages: getSessionMessagesMock,
    getSessionResponse: getSessionResponseMock,
    getSessionRequestHeaders: getSessionRequestHeadersMock,
    getSessionResponseHeaders: getSessionResponseHeadersMock,
    getSessionClientRequestMeta: getSessionClientRequestMetaMock,
    getSessionUpstreamRequestMeta: getSessionUpstreamRequestMetaMock,
    getSessionUpstreamResponseMeta: getSessionUpstreamResponseMetaMock,
    getSessionSpecialSettings: getSessionSpecialSettingsMock,
  },
}));

vi.mock("@/repository/message", () => ({
  aggregateSessionStats: aggregateSessionStatsMock,
  findAdjacentRequestSequences: findAdjacentRequestSequencesMock,
  findMessageRequestAuditBySessionIdAndSequence: findMessageRequestAuditBySessionIdAndSequenceMock,
}));

describe("getSessionDetails - unified specialSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    getSessionDetailsCacheMock.mockReturnValue(null);

    aggregateSessionStatsMock.mockResolvedValue({
      sessionId: "sess_x",
      requestCount: 1,
      totalCostUsd: "0",
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalDurationMs: 0,
      firstRequestAt: new Date(),
      lastRequestAt: new Date(),
      providers: [],
      models: [],
      userName: "u",
      userId: 1,
      keyName: "k",
      keyId: 1,
      userAgent: null,
      apiType: "chat",
      cacheTtlApplied: null,
    });

    findAdjacentRequestSequencesMock.mockResolvedValue({ prevSequence: null, nextSequence: null });

    getSessionRequestCountMock.mockResolvedValue(1);
    getSessionRequestBodyMock.mockResolvedValue(null);
    getSessionMessagesMock.mockResolvedValue(null);
    getSessionResponseMock.mockResolvedValue(null);
    getSessionRequestHeadersMock.mockResolvedValue(null);
    getSessionResponseHeadersMock.mockResolvedValue(null);
    getSessionClientRequestMetaMock.mockResolvedValue(null);
    getSessionUpstreamRequestMetaMock.mockResolvedValue(null);
    getSessionUpstreamResponseMetaMock.mockResolvedValue(null);
  });

  test("当 Redis specialSettings 为空时，应由 DB 审计字段派生特殊设置", async () => {
    getSessionSpecialSettingsMock.mockResolvedValue(null);
    findMessageRequestAuditBySessionIdAndSequenceMock.mockResolvedValue({
      statusCode: 200,
      blockedBy: "warmup",
      blockedReason: JSON.stringify({ reason: "anthropic_warmup_intercepted" }),
      cacheTtlApplied: "1h",
      context1mApplied: true,
      specialSettings: null,
    });

    const { getSessionDetails } = await import("@/actions/active-sessions");
    const result = await getSessionDetails("sess_x", 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const types = (result.data.specialSettings ?? []).map((s) => s.type).sort();
    expect(types).toEqual(
      [
        "anthropic_cache_ttl_header_override",
        "anthropic_context_1m_header_override",
        "guard_intercept",
      ].sort()
    );
  });

  test("当 Redis 与 DB 同时存在 specialSettings 时，应合并并去重", async () => {
    getSessionSpecialSettingsMock.mockResolvedValue([
      {
        type: "provider_parameter_override",
        scope: "provider",
        providerId: 1,
        providerName: "p",
        providerType: "codex",
        hit: true,
        changed: true,
        changes: [{ path: "temperature", before: 1, after: 0.2, changed: true }],
      },
    ]);

    findMessageRequestAuditBySessionIdAndSequenceMock.mockResolvedValue({
      statusCode: 200,
      blockedBy: "warmup",
      blockedReason: JSON.stringify({ reason: "anthropic_warmup_intercepted" }),
      cacheTtlApplied: null,
      context1mApplied: false,
      specialSettings: [
        {
          type: "provider_parameter_override",
          scope: "provider",
          providerId: 1,
          providerName: "p",
          providerType: "codex",
          hit: true,
          changed: true,
          changes: [{ path: "temperature", before: 1, after: 0.2, changed: true }],
        },
      ],
    });

    const { getSessionDetails } = await import("@/actions/active-sessions");
    const result = await getSessionDetails("sess_x", 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const settings = result.data.specialSettings ?? [];
    expect(settings.some((s) => s.type === "provider_parameter_override")).toBe(true);
    expect(settings.some((s) => s.type === "guard_intercept")).toBe(true);
    expect(settings.filter((s) => s.type === "provider_parameter_override").length).toBe(1);
  });
});
