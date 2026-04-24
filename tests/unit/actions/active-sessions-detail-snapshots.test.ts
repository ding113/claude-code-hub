import { beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_SESSION_DETAIL_VIEW_MODE } from "@/types/session";

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
const getSessionRequestPhaseSnapshotMock = vi.fn();
const getSessionResponsePhaseSnapshotMock = vi.fn();

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
  findAdjacentRequestSequences: findAdjacentRequestSequencesMock,
  findMessageRequestAuditBySessionIdAndSequence: findMessageRequestAuditBySessionIdAndSequenceMock,
}));

describe("getSessionDetails - additive detail snapshots contract", () => {
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
    findMessageRequestAuditBySessionIdAndSequenceMock.mockResolvedValue(null);

    getSessionRequestCountMock.mockResolvedValue(1);
    getSessionRequestBodyMock.mockResolvedValue({ model: "gpt-5.2", input: "hi" });
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

    expect(result.data.requestBody).toEqual({ model: "gpt-5.2", input: "hi" });
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
          body: { model: "gpt-5.2", input: "hi" },
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

  test("builds before-after snapshots from new snapshot getters", async () => {
    getSessionRequestPhaseSnapshotMock
      .mockResolvedValueOnce({
        body: { model: "gpt-5.2", messages: [{ role: "user", content: "before body" }] },
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
          model: "gpt-5.2",
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
          body: { model: "gpt-5.2", messages: [{ role: "user", content: "before body" }] },
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
            model: "gpt-5.2",
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
        model: "gpt-5.2",
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
        model: "gpt-5.2",
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
    findAdjacentRequestSequencesMock.mockResolvedValue({ prevSequence: 2, nextSequence: null });
    getSessionRequestPhaseSnapshotMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      body: JSON.stringify({ model: "gpt-5.2", messages: [] }),
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
});
