import { beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_SESSION_DETAIL_VIEW_MODE } from "@/types/session";

const getSessionMock = vi.fn();

const getSessionDetailsCacheMock = vi.fn();
const setSessionDetailsCacheMock = vi.fn();

const getSessionRequestCountMock = vi.fn();
const hasAnySessionMessagesMock = vi.fn();
const getSessionRequestBodyMock = vi.fn();
const getSessionMessagesMock = vi.fn();
const getSessionResponseMock = vi.fn();
const getSessionRequestHeadersMock = vi.fn();
const getSessionResponseHeadersMock = vi.fn();
const getSessionClientRequestMetaMock = vi.fn();
const getSessionUpstreamRequestMetaMock = vi.fn();
const getSessionUpstreamResponseMetaMock = vi.fn();
const getSessionSpecialSettingsMock = vi.fn();
const getSessionRequestPhaseSnapshotMock = vi.fn();
const getSessionResponsePhaseSnapshotMock = vi.fn();

const aggregateSessionStatsMock = vi.fn();
const aggregateMultipleSessionStatsMock = vi.fn();
const resolveSessionIdentityMock = vi.fn();
const isSessionSourceForIdentityMock = vi.fn();
const findSessionRequestLocatorMock = vi.fn();
const findAdjacentSessionRequestsMock = vi.fn();
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
  clearAllSessionsQueryCache: vi.fn(),
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
    hasAnySessionMessages: hasAnySessionMessagesMock,
    getSessionRequestBody: getSessionRequestBodyMock,
    getSessionMessages: getSessionMessagesMock,
    getSessionResponse: getSessionResponseMock,
    getSessionRequestHeaders: getSessionRequestHeadersMock,
    getSessionResponseHeaders: getSessionResponseHeadersMock,
    getSessionClientRequestMeta: getSessionClientRequestMetaMock,
    getSessionUpstreamRequestMeta: getSessionUpstreamRequestMetaMock,
    getSessionUpstreamResponseMeta: getSessionUpstreamResponseMetaMock,
    getSessionSpecialSettings: getSessionSpecialSettingsMock,
    getSessionRequestPhaseSnapshot: getSessionRequestPhaseSnapshotMock,
    getSessionResponsePhaseSnapshot: getSessionResponsePhaseSnapshotMock,
  },
}));

vi.mock("@/repository/message", () => ({
  aggregateSessionStats: aggregateSessionStatsMock,
  aggregateMultipleSessionStats: aggregateMultipleSessionStatsMock,
  resolveSessionIdentity: resolveSessionIdentityMock,
  isSessionSourceForIdentity: isSessionSourceForIdentityMock,
  findSessionRequestLocator: findSessionRequestLocatorMock,
  findAdjacentSessionRequests: findAdjacentSessionRequestsMock,
  findMessageRequestAuditBySessionIdAndSequence: findMessageRequestAuditBySessionIdAndSequenceMock,
}));

describe("getSessionDetails - additive detail snapshots contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    getSessionDetailsCacheMock.mockReturnValue(null);
    findSessionRequestLocatorMock.mockReset();

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
    aggregateMultipleSessionStatsMock.mockImplementation(async (sessionIds: string[]) => {
      const stats = await aggregateSessionStatsMock(sessionIds[0]);
      return stats ? [{ ...stats, sessionId: stats.sessionId ?? sessionIds[0] }] : [];
    });
    resolveSessionIdentityMock.mockResolvedValue(null);
    isSessionSourceForIdentityMock.mockResolvedValue(true);
    findSessionRequestLocatorMock.mockImplementation(
      async (
        identity: string,
        selector: { requestId?: number; sourceSessionId?: string; requestSequence?: number } = {}
      ) => ({
        requestId: selector.requestId ?? 101,
        sourceSessionId: selector.sourceSessionId ?? identity,
        requestSequence: selector.requestSequence ?? 1,
        identityKind: identity.startsWith("pfx:") ? "prefix_affinity" : "session_id",
        scopeTag: identity.startsWith("pfx:") ? "scope" : null,
        fingerprint: identity.startsWith("pfx:") ? "fingerprint" : null,
      })
    );

    findAdjacentSessionRequestsMock.mockResolvedValue({ prevRequest: null, nextRequest: null });
    findMessageRequestAuditBySessionIdAndSequenceMock.mockResolvedValue(null);

    getSessionRequestCountMock.mockResolvedValue(1);
    hasAnySessionMessagesMock.mockResolvedValue(true);
    getSessionRequestBodyMock.mockResolvedValue({ model: "gpt-5.5", input: "hi" });
    getSessionMessagesMock.mockResolvedValue([{ role: "user", content: "hi" }]);
    getSessionResponseMock.mockResolvedValue('{"ok":true}');
    getSessionRequestHeadersMock.mockResolvedValue({ "content-type": "application/json" });
    getSessionResponseHeadersMock.mockResolvedValue({ "x-response-id": "resp_1" });
    getSessionClientRequestMetaMock.mockResolvedValue({
      url: "https://client.example/v1/responses",
      method: "POST",
    });
    getSessionUpstreamRequestMetaMock.mockResolvedValue({
      url: "https://upstream.example/v1/responses",
      method: "POST",
    });
    getSessionUpstreamResponseMetaMock.mockResolvedValue({
      url: "https://upstream.example/v1/responses",
      statusCode: 200,
    });
    getSessionSpecialSettingsMock.mockResolvedValue(null);
    getSessionRequestPhaseSnapshotMock.mockResolvedValue(null);
    getSessionResponsePhaseSnapshotMock.mockResolvedValue(null);
  });

  test("returns additive snapshots contract without removing legacy flat fields", async () => {
    const { getSessionDetails } = await import("@/actions/active-sessions");
    const result = await getSessionDetails("sess_x", 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.requestBody).toEqual({ model: "gpt-5.5", input: "hi" });
    expect(result.data.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(result.data.response).toBe('{"ok":true}');
    expect(result.data.requestHeaders).toEqual({ "content-type": "application/json" });
    expect(result.data.responseHeaders).toEqual({ "x-response-id": "resp_1" });
    expect(result.data.requestMeta).toEqual({
      clientUrl: "https://client.example/v1/responses",
      upstreamUrl: "https://upstream.example/v1/responses",
      method: "POST",
    });
    expect(result.data.responseMeta).toEqual({
      upstreamUrl: "https://upstream.example/v1/responses",
      statusCode: 200,
    });

    expect(result.data.snapshots).toEqual({
      defaultView: DEFAULT_SESSION_DETAIL_VIEW_MODE,
      request: {
        before: null,
        after: {
          body: { model: "gpt-5.5", input: "hi" },
          messages: [{ role: "user", content: "hi" }],
          headers: { "content-type": "application/json" },
          meta: {
            clientUrl: "https://client.example/v1/responses",
            upstreamUrl: "https://upstream.example/v1/responses",
            method: "POST",
          },
        },
      },
      response: {
        before: null,
        after: {
          body: '{"ok":true}',
          headers: { "x-response-id": "resp_1" },
          meta: {
            upstreamUrl: "https://upstream.example/v1/responses",
            statusCode: 200,
          },
        },
      },
    });
  });

  test("uses an authorized physical source when a prefix identity spans multiple Sessions", async () => {
    aggregateSessionStatsMock.mockResolvedValue({
      sessionId: "pfx:scope:fingerprint",
      requestCount: 2,
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
    resolveSessionIdentityMock.mockResolvedValue({
      sourceSessionId: "physical-latest",
      scopeTag: "scope",
      fingerprints: ["fingerprint"],
    });

    const { getSessionDetails } = await import("@/actions/active-sessions");
    const result = await getSessionDetails("pfx:scope:fingerprint", 1, "physical-selected", 101);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.currentSourceSessionId).toBe("physical-selected");
    expect(result.data.currentSequence).toBe(1);
    expect(findSessionRequestLocatorMock).toHaveBeenCalledWith("pfx:scope:fingerprint", {
      requestId: 101,
      requestSequence: 1,
      sourceSessionId: "physical-selected",
    });
    expect(getSessionRequestBodyMock).toHaveBeenCalledWith("physical-selected", 1);
    expect(findAdjacentSessionRequestsMock).toHaveBeenCalledWith("pfx:scope:fingerprint", 101);
    expect(findMessageRequestAuditBySessionIdAndSequenceMock).toHaveBeenCalledWith(
      "physical-selected",
      1
    );
  });

  test("rejects a physical source and sequence that do not belong to the prefix identity", async () => {
    aggregateSessionStatsMock.mockResolvedValue({
      sessionId: "pfx:scope:fingerprint",
      userId: 1,
    });
    findSessionRequestLocatorMock
      .mockResolvedValueOnce({
        sourceSessionId: "physical-latest",
        requestSequence: 10,
        identityKind: "prefix_affinity",
        scopeTag: "scope",
        fingerprint: "fingerprint",
      })
      .mockResolvedValueOnce(null);

    const { getSessionDetails } = await import("@/actions/active-sessions");
    const result = await getSessionDetails("pfx:scope:fingerprint", 9, "physical-selected");

    expect(result).toEqual({
      ok: false,
      error: "SESSION_REQUEST_SOURCE_MISMATCH",
      errorCode: "SESSION_REQUEST_SOURCE_MISMATCH",
    });
    expect(getSessionRequestBodyMock).not.toHaveBeenCalled();
  });

  test("requires source Session together with sequence for a prefix identity", async () => {
    aggregateSessionStatsMock.mockResolvedValue({
      sessionId: "pfx:scope:fingerprint",
      userId: 1,
    });

    const { getSessionDetails } = await import("@/actions/active-sessions");
    const result = await getSessionDetails("pfx:scope:fingerprint", 1);

    expect(result).toEqual({
      ok: false,
      error: "SESSION_REQUEST_SELECTOR_INCOMPLETE",
      errorCode: "SESSION_REQUEST_SELECTOR_INCOMPLETE",
    });
    expect(findSessionRequestLocatorMock).toHaveBeenCalledTimes(1);
    expect(findSessionRequestLocatorMock).toHaveBeenCalledWith("pfx:scope:fingerprint");
  });

  test("builds before-after snapshots from new snapshot getters", async () => {
    getSessionRequestPhaseSnapshotMock
      .mockResolvedValueOnce({
        body: { model: "gpt-5.5", messages: [{ role: "user", content: "before body" }] },
        messages: [{ role: "user", content: "before messages" }],
        headers: { "x-before": "1" },
        meta: {
          clientUrl: "https://client.example/v1/responses",
          upstreamUrl: null,
          method: "POST",
        },
      })
      .mockResolvedValueOnce({
        body: JSON.stringify({
          model: "gpt-5.5",
          messages: [{ role: "user", content: "after body messages" }],
        }),
        messages: null,
        headers: { "x-after": "1" },
        meta: {
          clientUrl: null,
          upstreamUrl: "https://upstream.example/v1/responses",
          method: "POST",
        },
      });
    getSessionResponsePhaseSnapshotMock
      .mockResolvedValueOnce({
        body: '{"before":true}',
        headers: { "x-upstream": "1" },
        meta: {
          upstreamUrl: "https://upstream.example/v1/responses",
          statusCode: 200,
        },
      })
      .mockResolvedValueOnce({
        body: '{"after":true}',
        headers: { "x-client": "1" },
        meta: {
          upstreamUrl: null,
          statusCode: 200,
        },
      });

    const { getSessionDetails } = await import("@/actions/active-sessions");
    const result = await getSessionDetails("sess_x", 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.snapshots).toEqual({
      defaultView: DEFAULT_SESSION_DETAIL_VIEW_MODE,
      request: {
        before: {
          body: { model: "gpt-5.5", messages: [{ role: "user", content: "before body" }] },
          messages: [{ role: "user", content: "before messages" }],
          headers: { "x-before": "1" },
          meta: {
            clientUrl: "https://client.example/v1/responses",
            upstreamUrl: null,
            method: "POST",
          },
        },
        after: {
          body: {
            model: "gpt-5.5",
            messages: [{ role: "user", content: "after body messages" }],
          },
          messages: [{ role: "user", content: "after body messages" }],
          headers: { "x-after": "1" },
          meta: {
            clientUrl: null,
            upstreamUrl: "https://upstream.example/v1/responses",
            method: "POST",
          },
        },
      },
      response: {
        before: {
          body: '{"before":true}',
          headers: { "x-upstream": "1" },
          meta: {
            upstreamUrl: "https://upstream.example/v1/responses",
            statusCode: 200,
          },
        },
        after: {
          body: '{"after":true}',
          headers: { "x-client": "1" },
          meta: {
            upstreamUrl: null,
            statusCode: 200,
          },
        },
      },
    });
  });

  test("returns null after request messages when processed body has no messages field", async () => {
    getSessionRequestPhaseSnapshotMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      body: JSON.stringify({
        model: "gpt-5.5",
        input: [{ role: "user", content: "no messages field here" }],
      }),
      messages: null,
      headers: { "x-after": "1" },
      meta: {
        clientUrl: null,
        upstreamUrl: "https://upstream.example/v1/responses",
        method: "POST",
      },
    });
    getSessionResponsePhaseSnapshotMock.mockResolvedValue(null);

    const { getSessionDetails } = await import("@/actions/active-sessions");
    const result = await getSessionDetails("sess_x", 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.snapshots.request.after).toEqual({
      body: {
        model: "gpt-5.5",
        input: [{ role: "user", content: "no messages field here" }],
      },
      messages: null,
      headers: { "x-after": "1" },
      meta: {
        clientUrl: null,
        upstreamUrl: "https://upstream.example/v1/responses",
        method: "POST",
      },
    });
  });

  test("falls back to the latest request sequence when requestSequence is omitted", async () => {
    getSessionRequestCountMock.mockResolvedValue(3);
    findSessionRequestLocatorMock.mockResolvedValueOnce({
      sourceSessionId: "sess_x",
      requestSequence: 3,
      identityKind: "session_id",
      scopeTag: null,
      fingerprint: null,
    });
    findAdjacentSessionRequestsMock.mockResolvedValue({
      prevRequest: { requestId: 102, sourceSessionId: "sess_x", requestSequence: 2 },
      nextRequest: null,
    });
    getSessionRequestPhaseSnapshotMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      body: JSON.stringify({ model: "gpt-5.5", messages: [] }),
      messages: null,
      headers: { "x-after": "3" },
      meta: {
        clientUrl: null,
        upstreamUrl: "https://upstream.example/v1/responses",
        method: "POST",
      },
    });
    getSessionResponsePhaseSnapshotMock.mockResolvedValue(null);

    const { getSessionDetails } = await import("@/actions/active-sessions");
    const result = await getSessionDetails("sess_x");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(getSessionRequestPhaseSnapshotMock).toHaveBeenCalledWith("sess_x", "before", 3);
    expect(getSessionRequestPhaseSnapshotMock).toHaveBeenCalledWith("sess_x", "after", 3);
    expect(result.data.currentSequence).toBe(3);
    expect(result.data.prevRequest).toEqual({
      requestId: 102,
      sourceSessionId: "sess_x",
      requestSequence: 2,
    });
    expect(result.data.prevSequence).toBe(2);
    expect(result.data.snapshots.request.after?.messages).toEqual([]);
  });

  test("uses legacy fields as after snapshot compatibility when new snapshots are absent", async () => {
    getSessionRequestBodyMock.mockResolvedValue("raw-forwarded-request-body");
    getSessionMessagesMock.mockResolvedValue([{ role: "user", content: "legacy request" }]);
    getSessionResponseMock.mockResolvedValue('{"legacy":true}');
    getSessionRequestHeadersMock.mockResolvedValue({ "x-legacy": "1" });
    getSessionResponseHeadersMock.mockResolvedValue({ "x-legacy-response": "1" });
    getSessionRequestPhaseSnapshotMock.mockResolvedValue(null);
    getSessionResponsePhaseSnapshotMock.mockResolvedValue(null);

    const { getSessionDetails } = await import("@/actions/active-sessions");
    const result = await getSessionDetails("sess_x", 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.snapshots.request.before).toBeNull();
    expect(result.data.snapshots.request.after).toEqual({
      body: null,
      messages: [{ role: "user", content: "legacy request" }],
      headers: { "x-legacy": "1" },
      meta: {
        clientUrl: "https://client.example/v1/responses",
        upstreamUrl: "https://upstream.example/v1/responses",
        method: "POST",
      },
    });
    expect(result.data.snapshots.response.after).toEqual({
      body: '{"legacy":true}',
      headers: { "x-legacy-response": "1" },
      meta: {
        upstreamUrl: "https://upstream.example/v1/responses",
        statusCode: 200,
      },
    });
  });

  test("非法请求序号归一化为空时检查 Session 是否存在任意 messages", async () => {
    const { hasSessionMessages } = await import("@/actions/active-sessions");

    const result = await hasSessionMessages("sess_x", 0);

    expect(result).toEqual({ ok: true, data: true });
    expect(hasAnySessionMessagesMock).toHaveBeenCalledWith("sess_x");
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("uses request id to check the exact request when sequence is absent", async () => {
    const { hasSessionMessages } = await import("@/actions/active-sessions");

    const result = await hasSessionMessages("pfx:scope:root", undefined, "physical-a", 203);

    expect(result).toEqual({ ok: true, data: true });
    expect(findSessionRequestLocatorMock).toHaveBeenLastCalledWith("sess_x", {
      requestId: 203,
      requestSequence: undefined,
      sourceSessionId: "physical-a",
    });
    expect(getSessionMessagesMock).toHaveBeenCalledWith("physical-a", 1);
    expect(hasAnySessionMessagesMock).not.toHaveBeenCalled();
  });
});
