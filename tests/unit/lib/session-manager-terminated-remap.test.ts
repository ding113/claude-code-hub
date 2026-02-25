import { beforeEach, describe, expect, it, vi } from "vitest";

let redisClientRef: any;

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock("@/app/v1/_lib/proxy/errors", () => ({
  sanitizeHeaders: vi.fn(() => "(empty)"),
  sanitizeUrl: vi.fn((url: unknown) => String(url)),
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    getConcurrentCount: vi.fn(async () => 0),
  },
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisClientRef,
}));

function makePipeline() {
  const pipeline = {
    setex: vi.fn(() => pipeline),
    expire: vi.fn(() => pipeline),
    exec: vi.fn(async () => []),
  };
  return pipeline;
}

describe("SessionManager.getOrCreateSessionId - terminated blocking", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();

    redisClientRef = {
      status: "ready",
      get: vi.fn(async () => null),
      pipeline: vi.fn(() => makePipeline()),
    };
  });

  it("未终止时应保持原 sessionId", async () => {
    const { SessionManager } = await import("@/lib/session-manager");

    const keyId = 1;
    const oldSessionId = "sess_old";
    const messages = [{ role: "user", content: "hi" }];

    const sessionId = await SessionManager.getOrCreateSessionId(keyId, messages, oldSessionId);

    expect(sessionId).toBe(oldSessionId);
    expect(redisClientRef.get).toHaveBeenCalledWith(`session:${oldSessionId}:terminated`);
  });

  it("已终止时应拒绝复用并抛出 TerminatedSessionError", async () => {
    const keyId = 1;
    const oldSessionId = "sess_old";
    redisClientRef.get.mockImplementation(async (key: string) => {
      if (key === `session:${oldSessionId}:terminated`) return "1";
      return null;
    });

    const { SessionManager, TerminatedSessionError } = await import("@/lib/session-manager");

    await expect(
      SessionManager.getOrCreateSessionId(keyId, [], oldSessionId)
    ).rejects.toBeInstanceOf(TerminatedSessionError);
  });

  it("hash 命中已终止 session 时应创建新 session", async () => {
    const keyId = 1;
    const terminatedSessionId = "sess_terminated";

    const { SessionManager } = await import("@/lib/session-manager");
    vi.spyOn(SessionManager, "generateSessionId").mockReturnValue("sess_new");

    redisClientRef.get.mockImplementation(async (key: string) => {
      if (key.startsWith("hash:") && key.endsWith(":session")) return terminatedSessionId;
      if (key === `session:${terminatedSessionId}:terminated`) return "1";
      return null;
    });

    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "ok" },
    ];

    const sessionId = await SessionManager.getOrCreateSessionId(keyId, messages, null);

    expect(sessionId).toBe("sess_new");
    expect(redisClientRef.get).toHaveBeenCalledWith(`session:${terminatedSessionId}:terminated`);
  });
});
