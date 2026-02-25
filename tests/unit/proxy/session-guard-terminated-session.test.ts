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

class TerminatedSessionError extends Error {
  sessionId: string;
  terminatedAt: string | null;

  constructor(sessionId: string, terminatedAt: string | null = null) {
    super("Session has been terminated");
    this.name = "TerminatedSessionError";
    this.sessionId = sessionId;
    this.terminatedAt = terminatedAt;
  }
}

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
  TerminatedSessionError,
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
    getMessages() {
      return [];
    },
    getMessagesLength() {
      return 1;
    },
    isWarmupRequest() {
      return false;
    },
  } satisfies Partial<ProxySession>;

  return { ...session, ...overrides } as ProxySession;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCachedSystemSettingsMock.mockResolvedValue({
    interceptAnthropicWarmupRequests: false,
    enableCodexSessionIdCompletion: false,
  });
  extractClientSessionIdMock.mockReturnValue("sess_terminated");
  getNextRequestSequenceMock.mockResolvedValue(1);
});

describe("ProxySessionGuard - terminated session", () => {
  test("当 clientSessionId 已终止时应阻断请求并抛出 ProxyError(410)", async () => {
    const ProxySessionGuard = await loadGuard();
    const session = createMockSession();

    getOrCreateSessionIdMock.mockRejectedValueOnce(
      new TerminatedSessionError("sess_terminated", "1")
    );

    await expect(ProxySessionGuard.ensure(session)).rejects.toMatchObject({
      name: "ProxyError",
      statusCode: 410,
      message: "Session 已被终止，请创建新的会话后重试",
    });

    expect(generateSessionIdMock).not.toHaveBeenCalled();
    expect(trackSessionMock).not.toHaveBeenCalled();
    expect(session.sessionId).toBeNull();
  });
});
