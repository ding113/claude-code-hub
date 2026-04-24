import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { V1_ENDPOINT_PATHS } from "@/app/v1/_lib/proxy/endpoint-paths";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

const callOrder: string[] = [];

const getCachedSystemSettingsMock = vi.fn();
const extractClientSessionIdMock = vi.fn();
const getOrCreateSessionIdMock = vi.fn();
const getNextRequestSequenceMock = vi.fn();
const completeCodexSessionIdentifiersMock = vi.fn();
const injectClaudeMetadataUserIdWithContextMock = vi.fn();

vi.mock("@/app/v1/_lib/proxy/auth-guard", () => ({
  ProxyAuthenticator: {
    ensure: async () => {
      callOrder.push("auth");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/client-guard", () => ({
  ProxyClientGuard: {
    ensure: async () => {
      callOrder.push("client");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/model-guard", () => ({
  ProxyModelGuard: {
    ensure: async () => {
      callOrder.push("model");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/version-guard", () => ({
  ProxyVersionGuard: {
    ensure: async () => {
      callOrder.push("version");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/sensitive-word-guard", () => ({
  ProxySensitiveWordGuard: {
    ensure: async () => {
      callOrder.push("sensitive");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/rate-limit-guard", () => ({
  ProxyRateLimitGuard: {
    ensure: async () => {
      callOrder.push("rateLimit");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/request-filter", () => ({
  ProxyRequestFilter: {
    ensure: async () => {
      callOrder.push("requestFilter");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/provider-request-filter", () => ({
  ProxyProviderRequestFilter: {
    ensure: async () => {
      callOrder.push("providerRequestFilter");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/session-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/v1/_lib/proxy/session-guard")>();
  return {
    ...actual,
    ProxySessionGuard: {
      ...actual.ProxySessionGuard,
      ensure: async (...args: Parameters<typeof actual.ProxySessionGuard.ensure>) => {
        callOrder.push("session");
        await actual.ProxySessionGuard.ensure(...args);
      },
    },
  };
});

vi.mock("@/app/v1/_lib/proxy/provider-selector", () => ({
  ProxyProviderResolver: {
    ensure: async (session: { setProvider: (provider: Provider) => void }) => {
      callOrder.push("provider");
      session.setProvider({
        id: 11,
        name: "provider-a",
        providerType: "claude",
        url: "https://provider-a.example.com",
        key: "test-key",
        preserveClientIp: false,
      } as Provider);
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/message-service", () => ({
  ProxyMessageService: {
    ensureContext: async (session: {
      setMessageContext: (context: unknown) => void;
      authState: {
        user: { id: number; name: string };
        key: { id: number; name: string };
        apiKey: string;
      };
      provider: { id: number };
    }) => {
      callOrder.push("messageContext");
      session.setMessageContext({
        id: 501,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        user: session.authState.user,
        key: session.authState.key,
        apiKey: session.authState.apiKey,
      });
      return null;
    },
  },
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    getCachedSystemSettings: () => getCachedSystemSettingsMock(),
  };
});

vi.mock("@/lib/session-manager", () => ({
  headersToSanitizedObject: (headers: Headers) => Object.fromEntries(headers.entries()),
  SessionManager: {
    extractClientSessionId: extractClientSessionIdMock,
    getOrCreateSessionId: getOrCreateSessionIdMock,
    getNextRequestSequence: getNextRequestSequenceMock,
    storeSessionRequestBody: vi.fn(async () => undefined),
    storeSessionClientRequestMeta: vi.fn(async () => undefined),
    storeSessionMessages: vi.fn(async () => undefined),
    storeSessionRequestPhaseSnapshot: vi.fn(async () => undefined),
    storeSessionInfo: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    trackSession: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/rate-limit/concurrent-session-limit", () => ({
  resolveKeyUserConcurrentSessionLimits: vi.fn(() => ({ enabled: false })),
}));

vi.mock("@/lib/claude-code/metadata-user-id", () => ({
  injectClaudeMetadataUserIdWithContext: (...args: unknown[]) =>
    injectClaudeMetadataUserIdWithContextMock(...args),
}));

vi.mock("@/app/v1/codex/session-completer", () => ({
  completeCodexSessionIdentifiers: (...args: unknown[]) =>
    completeCodexSessionIdentifiersMock(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

function createProxySession(pathname: string) {
  const session = Object.create(ProxySession.prototype) as ProxySession & {
    endpointPolicy: ReturnType<typeof resolveEndpointPolicy>;
    request: { message: Record<string, unknown>; model: string | null };
  };

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL(`https://proxy.example.com${pathname}`),
    headers: new Headers(),
    originalHeaders: new Headers(),
    headerLog: "",
    request: {
      message: {},
      model: "test-model",
      log: "{}",
    },
    userAgent: "test-agent/1.0",
    context: null,
    clientAbortSignal: null,
    userName: "tester",
    authState: {
      success: true,
      user: { id: 1, name: "tester" },
      key: { id: 9, name: "demo-key" },
      apiKey: "sk-test",
    },
    provider: null,
    messageContext: null,
    sessionId: null,
    requestSequence: 1,
    originalFormat: "claude",
    providerType: null,
    originalModelName: null,
    originalUrlPathname: null,
    providerChain: [],
    cacheTtlResolved: null,
    context1mApplied: false,
    specialSettings: [],
    endpointPolicy: resolveEndpointPolicy(pathname),
    isHeaderModified: () => false,
    setHighConcurrencyModeEnabled: vi.fn(),
    shouldPersistSessionDebugArtifacts: () => false,
    shouldTrackSessionObservability: () => false,
    setSessionId(id: string) {
      this.sessionId = id;
    },
    setRequestSequence(sequence: number) {
      this.requestSequence = sequence;
    },
    getRequestSequence() {
      return this.requestSequence;
    },
    getMessages() {
      const message = this.request.message as Record<string, unknown>;
      if (Array.isArray(message.messages)) return message.messages;
      if (Array.isArray(message.input)) return message.input;
      return [];
    },
    getMessagesLength() {
      return this.getMessages().length;
    },
    isProbeRequest: () => {
      callOrder.push("probe");
      return false;
    },
    isWarmupRequest: () => false,
    setProvider(provider: Provider | null) {
      this.provider = provider;
    },
    setMessageContext(context: unknown) {
      this.messageContext = context as ProxySession["messageContext"];
    },
    addSpecialSetting: vi.fn(),
    getSpecialSettings: vi.fn(() => []),
  });

  session.setRawCrossProviderFallbackEnabled(session.endpointPolicy.allowRawCrossProviderFallback);

  return session;
}

beforeEach(() => {
  callOrder.length = 0;
  vi.clearAllMocks();
  getCachedSystemSettingsMock.mockResolvedValue({
    allowNonConversationEndpointProviderFallback: true,
    enableHighConcurrencyMode: false,
    interceptAnthropicWarmupRequests: false,
    enableCodexSessionIdCompletion: true,
    enableClaudeMetadataUserIdInjection: true,
  });
  extractClientSessionIdMock.mockReturnValue(null);
  getOrCreateSessionIdMock.mockResolvedValue("session_assigned");
  getNextRequestSequenceMock.mockResolvedValue(2);
  completeCodexSessionIdentifiersMock.mockResolvedValue({
    applied: true,
    action: "generated",
    source: "test",
    sessionId: "generated-session",
  });
  injectClaudeMetadataUserIdWithContextMock.mockImplementation((message) => ({
    ...((message as Record<string, unknown>) ?? {}),
    metadata: { user_id: "user_test" },
  }));
});

describe("non-chat endpoint session context", () => {
  test("target raw endpoints include session and request context but still bypass chat-only guards", async () => {
    const { GuardPipelineBuilder } = await import("@/app/v1/_lib/proxy/guard-pipeline");

    for (const endpoint of [
      V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS,
      V1_ENDPOINT_PATHS.RESPONSES_COMPACT,
    ]) {
      callOrder.length = 0;
      const session = createProxySession(endpoint);
      const pipeline = GuardPipelineBuilder.fromSession(session);

      const response = await pipeline.run(session);

      expect(response).toBeNull();
      expect(callOrder).toEqual([
        "auth",
        "client",
        "model",
        "version",
        "probe",
        "session",
        "provider",
        "messageContext",
      ]);
      expect(callOrder).not.toContain("sensitive");
      expect(callOrder).not.toContain("warmup");
      expect(callOrder).not.toContain("requestFilter");
      expect(callOrder).not.toContain("rateLimit");
      expect(callOrder).not.toContain("providerRequestFilter");
      expect(session.sessionId).toBe("session_assigned");
      expect(session.requestSequence).toBe(2);
      expect(session.messageContext?.id).toBe(501);
    }
  });

  test("reuses session-bound provider for target raw endpoints", () => {
    const rawCountTokensSession = createProxySession(V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS);
    rawCountTokensSession.request.message = {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "count me" }],
    };
    rawCountTokensSession.sessionId = "sess_raw";

    const rawCompactSession = createProxySession(V1_ENDPOINT_PATHS.RESPONSES_COMPACT);
    rawCompactSession.originalFormat = "response";
    rawCompactSession.request.message = {
      model: "gpt-5",
      input: [{ role: "user", content: "compact me" }],
    };
    rawCompactSession.sessionId = "sess_compact";

    const regularMessagesSession = createProxySession(V1_ENDPOINT_PATHS.MESSAGES);
    regularMessagesSession.request.message = {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "hello" }],
    };
    regularMessagesSession.sessionId = "sess_chat";

    expect(rawCountTokensSession.shouldReuseProvider()).toBe(true);
    expect(rawCompactSession.shouldReuseProvider()).toBe(true);
    expect(regularMessagesSession.shouldReuseProvider()).toBe(false);

    rawCountTokensSession.setRawCrossProviderFallbackEnabled(false);
    rawCompactSession.setRawCrossProviderFallbackEnabled(false);

    expect(rawCountTokensSession.shouldReuseProvider()).toBe(false);
    expect(rawCompactSession.shouldReuseProvider()).toBe(false);
  });

  test("disabled runtime flag falls back to raw passthrough pipeline", async () => {
    const { GuardPipelineBuilder } = await import("@/app/v1/_lib/proxy/guard-pipeline");

    const session = createProxySession(V1_ENDPOINT_PATHS.RESPONSES_COMPACT);
    session.setRawCrossProviderFallbackEnabled(false);

    const pipeline = GuardPipelineBuilder.fromSession(session);
    await pipeline.run(session);

    expect(callOrder).toEqual(["auth", "client", "model", "version", "probe", "provider"]);
    expect(callOrder).not.toContain("session");
    expect(callOrder).not.toContain("messageContext");
  });

  test("raw-safe session context skips codex completion and claude metadata mutation", async () => {
    const { ProxySessionGuard } = await import("@/app/v1/_lib/proxy/session-guard");

    const compactSession = createProxySession(V1_ENDPOINT_PATHS.RESPONSES_COMPACT);
    compactSession.originalFormat = "response";
    compactSession.request.message = {
      model: "gpt-5",
      input: [{ role: "user", content: "compact me" }],
    };
    const compactBefore = structuredClone(compactSession.request.message);

    const countTokensSession = createProxySession(V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS);
    countTokensSession.originalFormat = "claude";
    countTokensSession.request.message = {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "count me" }],
      metadata: { session_id: "sess_seed" },
    };
    const countTokensBefore = structuredClone(countTokensSession.request.message);

    await ProxySessionGuard.ensure(compactSession);
    await ProxySessionGuard.ensure(countTokensSession);

    expect(completeCodexSessionIdentifiersMock).not.toHaveBeenCalled();
    expect(injectClaudeMetadataUserIdWithContextMock).not.toHaveBeenCalled();
    expect(compactSession.request.message).toEqual(compactBefore);
    expect(countTokensSession.request.message).toEqual(countTokensBefore);
    expect(compactSession.sessionId).toBe("session_assigned");
    expect(countTokensSession.sessionId).toBe("session_assigned");
  });
});
