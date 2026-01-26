import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";

const getCachedSystemSettingsMock = vi.fn();

const extractClientSessionIdMock = vi.fn();
const getOrCreateSessionIdMock = vi.fn();
const getNextRequestSequenceMock = vi.fn();
const storeSessionRequestBodyMock = vi.fn(async () => undefined);
const storeSessionClientRequestMetaMock = vi.fn(async () => undefined);
const storeSessionMessagesMock = vi.fn(async () => undefined);
const storeSessionInfoMock = vi.fn(async () => undefined);
const generateSessionIdMock = vi.fn();

const trackSessionMock = vi.fn(async () => undefined);

vi.mock("@/lib/config", () => ({
  getCachedSystemSettings: () => getCachedSystemSettingsMock(),
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    extractClientSessionId: extractClientSessionIdMock,
    getOrCreateSessionId: getOrCreateSessionIdMock,
    getNextRequestSequence: getNextRequestSequenceMock,
    storeSessionRequestBody: storeSessionRequestBodyMock,
    storeSessionClientRequestMeta: storeSessionClientRequestMetaMock,
    storeSessionMessages: storeSessionMessagesMock,
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
    generateDeterministicSessionId() {
      return "deterministic_session_id";
    },
    getMessages() {
      return [];
    },
    getMessagesLength() {
      return 1;
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
  getCachedSystemSettingsMock.mockResolvedValue({ interceptAnthropicWarmupRequests: true });
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
    getCachedSystemSettingsMock.mockResolvedValueOnce({ interceptAnthropicWarmupRequests: false });
    const session = createMockSession({ isWarmupRequest: () => true });

    await ProxySessionGuard.ensure(session);

    expect(trackSessionMock).toHaveBeenCalledTimes(1);
    expect(trackSessionMock).toHaveBeenCalledWith("session_assigned", 1, 1);
  });
});
