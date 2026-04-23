import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";

const getCachedSystemSettingsMock = vi.fn();

const extractClientSessionIdMock = vi.fn();
const getOrCreateSessionIdMock = vi.fn();
const getNextRequestSequenceMock = vi.fn();
const storeSessionRequestBodyMock = vi.fn(async () => undefined);
const storeSessionClientRequestMetaMock = vi.fn(async () => undefined);
const storeSessionMessagesMock = vi.fn(async () => undefined);
const storeSessionRequestPhaseSnapshotMock = vi.fn(async () => undefined);
const storeSessionInfoMock = vi.fn(async () => undefined);
const generateSessionIdMock = vi.fn();

const trackSessionMock = vi.fn(async () => undefined);

vi.mock("@/lib/config", () => ({
  getCachedSystemSettings: () => getCachedSystemSettingsMock(),
}));

vi.mock("@/lib/session-manager", () => ({
  headersToSanitizedObject: (headers: Headers) => Object.fromEntries(headers.entries()),
  SessionManager: {
    extractClientSessionId: extractClientSessionIdMock,
    getOrCreateSessionId: getOrCreateSessionIdMock,
    getNextRequestSequence: getNextRequestSequenceMock,
    storeSessionRequestBody: storeSessionRequestBodyMock,
    storeSessionClientRequestMeta: storeSessionClientRequestMetaMock,
    storeSessionMessages: storeSessionMessagesMock,
    storeSessionRequestPhaseSnapshot: storeSessionRequestPhaseSnapshotMock,
    storeSessionInfo: storeSessionInfoMock,
    generateSessionId: generateSessionIdMock,
  },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    trackSession: trackSessionMock,
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  },
}));

async function loadGuard() {
  const mod = await import("@/app/v1/_lib/proxy/session-guard");
  return mod.ProxySessionGuard;
}

function createMockSession(overrides: Partial<ProxySession> = {}): ProxySession {
  const session: any = {
    authState: {
      success: true,
      user: { id: 1, name: "u" },
      key: { id: 1, name: "k" },
      apiKey: "api-key",
    },
    request: {
      message: {},
      model: "claude-sonnet-4-5-20250929",
    },
    headers: new Headers(),
    userAgent: "claude_cli/1.0",
    requestUrl: "http://localhost/v1/messages",
    method: "POST",
    originalFormat: "claude",
    highConcurrencyModeEnabled: false,
    rawCrossProviderFallbackEnabled: false,
    addSpecialSetting: vi.fn(),
    setHighConcurrencyModeEnabled(enabled: boolean) {
      this.highConcurrencyModeEnabled = enabled;
    },
    setRawCrossProviderFallbackEnabled(enabled: boolean) {
      this.rawCrossProviderFallbackEnabled = enabled;
    },
    isRawCrossProviderFallbackEnabled() {
      return this.rawCrossProviderFallbackEnabled;
    },
    shouldPersistSessionDebugArtifacts() {
      return !this.highConcurrencyModeEnabled;
    },
    shouldTrackSessionObservability() {
      return !this.highConcurrencyModeEnabled;
    },

    sessionId: null,
    setSessionId(id: string) {
      this.sessionId = id;
    },
    setRequestSequence(seq: number) {
      this.requestSequence = seq;
    },
    getRequestSequence() {
      return this.requestSequence ?? 1;
    },
    getMessages() {
      return [];
    },
    getMessagesLength() {
      return 1;
    },
    getEndpointPolicy() {
      return resolveEndpointPolicy("/v1/messages");
    },
    isWarmupRequest() {
      return true;
    },
  } satisfies Partial<ProxySession>;

  return { ...session, ...overrides } as ProxySession;
}

beforeEach(() => {
  vi.clearAllMocks();
  extractClientSessionIdMock.mockReturnValue(null);
  getOrCreateSessionIdMock.mockResolvedValue("session_assigned");
  getNextRequestSequenceMock.mockResolvedValue(1);
  getCachedSystemSettingsMock.mockResolvedValue({
    enableHighConcurrencyMode: false,
    interceptAnthropicWarmupRequests: true,
    enableClaudeMetadataUserIdInjection: true,
  });
});

describe("ProxySessionGuard：warmup 拦截不应计入并发会话", () => {
  test("当 warmup 且开关开启时，不应调用 SessionTracker.trackSession", async () => {
    const ProxySessionGuard = await loadGuard();
    const session = createMockSession({ isWarmupRequest: () => true });

    await ProxySessionGuard.ensure(session);

    expect(trackSessionMock).not.toHaveBeenCalled();
    expect(session.sessionId).toBe("session_assigned");
  });

  test("当 warmup 但开关关闭时，应正常调用 SessionTracker.trackSession", async () => {
    const ProxySessionGuard = await loadGuard();
    getCachedSystemSettingsMock.mockResolvedValueOnce({
      enableHighConcurrencyMode: false,
      interceptAnthropicWarmupRequests: false,
    });
    const session = createMockSession({ isWarmupRequest: () => true });

    await ProxySessionGuard.ensure(session);

    expect(trackSessionMock).toHaveBeenCalledTimes(1);
    expect(trackSessionMock).toHaveBeenCalledWith("session_assigned", 1, 1);
  });

  test("高并发模式：仍分配 session/requestSequence，但跳过 request 调试快照与 session 观测写入", async () => {
    const ProxySessionGuard = await loadGuard();
    getCachedSystemSettingsMock.mockResolvedValueOnce({
      enableHighConcurrencyMode: true,
      interceptAnthropicWarmupRequests: false,
      enableClaudeMetadataUserIdInjection: true,
    });

    const session = createMockSession({ isWarmupRequest: () => false });

    await ProxySessionGuard.ensure(session);

    expect(session.sessionId).toBe("session_assigned");
    expect(session.getRequestSequence()).toBe(1);
    expect(storeSessionRequestBodyMock).not.toHaveBeenCalled();
    expect(storeSessionClientRequestMetaMock).not.toHaveBeenCalled();
    expect(storeSessionMessagesMock).not.toHaveBeenCalled();
    expect(storeSessionRequestPhaseSnapshotMock).not.toHaveBeenCalled();
    expect(storeSessionInfoMock).not.toHaveBeenCalled();
    expect(trackSessionMock).not.toHaveBeenCalled();
  });

  test("落 request.before 快照时保留原始请求体，并过滤客户端网络标识 headers", async () => {
    const ProxySessionGuard = await loadGuard();
    const session = createMockSession({
      headers: new Headers({
        "content-type": "application/json",
        "x-forwarded-for": "1.2.3.4",
      }),
      request: {
        message: {
          metadata: {
            session_id: "sess_seed",
          },
          messages: [{ role: "user", content: "hello" }],
        },
        model: "claude-sonnet-4-5-20250929",
      },
      getMessages() {
        return [{ role: "user", content: "hello" }];
      },
      isWarmupRequest: () => false,
    });

    await ProxySessionGuard.ensure(session);

    expect(storeSessionRequestPhaseSnapshotMock).toHaveBeenCalledWith(
      "session_assigned",
      "before",
      expect.objectContaining({
        body: {
          metadata: {
            session_id: "sess_seed",
          },
          messages: [{ role: "user", content: "hello" }],
        },
        headers: { "content-type": "application/json" },
        messages: [{ role: "user", content: "hello" }],
      }),
      1
    );
  });

  test("Claude 旧版本请求缺少 user_id 但有 metadata.session_id 时，应使用最终 sessionId 补全 user_id", async () => {
    const ProxySessionGuard = await loadGuard();
    extractClientSessionIdMock.mockImplementation((requestMessage: Record<string, unknown>) => {
      const metadata =
        requestMessage.metadata && typeof requestMessage.metadata === "object"
          ? (requestMessage.metadata as Record<string, unknown>)
          : {};

      if (typeof metadata.session_id === "string") {
        return metadata.session_id;
      }

      if (typeof metadata.user_id === "string") {
        const marker = "_account__session_";
        const markerIndex = metadata.user_id.indexOf(marker);
        return markerIndex === -1 ? null : metadata.user_id.slice(markerIndex + marker.length);
      }

      return null;
    });

    const session = createMockSession({
      userAgent: "claude-cli/2.1.77 (external, cli)",
      request: {
        message: {
          metadata: {
            session_id: "sess_legacy_seed",
          },
        },
        model: "claude-sonnet-4-5-20250929",
      },
      isWarmupRequest: () => false,
    });

    await ProxySessionGuard.ensure(session);

    expect((session.request.message.metadata as Record<string, unknown>).user_id).toMatch(
      /^user_[a-f0-9]{64}_account__session_session_assigned$/
    );
    expect(getOrCreateSessionIdMock).toHaveBeenCalledWith(1, [], "sess_legacy_seed");
  });

  test("Claude 无客户端 session 时，不应预生成 session 写回请求体，而应回填已分配 session", async () => {
    const ProxySessionGuard = await loadGuard();
    extractClientSessionIdMock.mockImplementation((requestMessage: Record<string, unknown>) => {
      const metadata =
        requestMessage.metadata && typeof requestMessage.metadata === "object"
          ? (requestMessage.metadata as Record<string, unknown>)
          : {};

      if (typeof metadata.user_id === "string") {
        try {
          const parsed = JSON.parse(metadata.user_id) as { session_id?: string };
          return parsed.session_id ?? null;
        } catch {
          return null;
        }
      }

      return null;
    });

    const session = createMockSession({
      userAgent: null,
      request: {
        message: {},
        model: "claude-sonnet-4-5-20250929",
      },
      isWarmupRequest: () => false,
    });

    await ProxySessionGuard.ensure(session);

    expect(
      JSON.parse((session.request.message.metadata as Record<string, unknown>).user_id as string)
    ).toEqual({
      device_id: expect.stringMatching(/^[a-f0-9]{64}$/),
      account_uuid: "",
      session_id: "session_assigned",
    });
    expect(getOrCreateSessionIdMock).toHaveBeenCalledWith(1, [], null);
    expect(generateSessionIdMock).not.toHaveBeenCalled();
  });

  test("当 warmup 请求会被拦截时，不应补全 Claude metadata.user_id", async () => {
    const ProxySessionGuard = await loadGuard();
    const session = createMockSession({
      userAgent: "claude-cli/2.1.78 (external, cli)",
      request: {
        message: {},
        model: "claude-sonnet-4-5-20250929",
      },
      isWarmupRequest: () => true,
    });

    await ProxySessionGuard.ensure(session);

    expect((session.request.message as Record<string, unknown>).metadata).toBeUndefined();
  });
});
