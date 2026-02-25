import { beforeEach, describe, expect, it, vi } from "vitest";

let redisClientRef: any;
const pipelineCalls: Array<unknown[]> = [];

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
    setex: vi.fn((...args: unknown[]) => {
      pipelineCalls.push(["setex", ...args]);
      return pipeline;
    }),
    expire: vi.fn((...args: unknown[]) => {
      pipelineCalls.push(["expire", ...args]);
      return pipeline;
    }),
    exec: vi.fn(async () => {
      pipelineCalls.push(["exec"]);
      return [];
    }),
  };
  return pipeline;
}

describe("SessionManager.getOrCreateSessionId - terminated remap", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    pipelineCalls.length = 0;

    redisClientRef = {
      status: "ready",
      mget: vi.fn(async () => [null, null]),
      pipeline: vi.fn(() => makePipeline()),
    };
  });

  it("未终止时应保持原 sessionId", async () => {
    const { SessionManager } = await import("@/lib/session-manager");

    const keyId = 1;
    const oldSessionId = "sess_old";
    const messages = [{ role: "user", content: "hi" }, { role: "assistant", content: "ok" }, {}];

    const sessionId = await SessionManager.getOrCreateSessionId(keyId, messages, oldSessionId);

    expect(sessionId).toBe(oldSessionId);
    expect(redisClientRef.mget).toHaveBeenCalledWith(
      `session:${oldSessionId}:terminated`,
      `session:${oldSessionId}:terminated_replacement`
    );
    expect(
      pipelineCalls.some(
        (c) => c[0] === "setex" && c[1] === `session:${oldSessionId}:terminated_replacement`
      )
    ).toBe(false);
  });

  it("已终止且存在 replacement 时应返回 replacement sessionId", async () => {
    const keyId = 1;
    const oldSessionId = "sess_old";
    const replacementSessionId = "sess_new";
    redisClientRef.mget.mockResolvedValueOnce(["1", replacementSessionId]);

    const { SessionManager } = await import("@/lib/session-manager");

    const sessionId = await SessionManager.getOrCreateSessionId(keyId, [], oldSessionId);

    expect(sessionId).toBe(replacementSessionId);
    expect(
      pipelineCalls.some(
        (c) => c[0] === "setex" && c[1] === `session:${oldSessionId}:terminated_replacement`
      )
    ).toBe(false);
  });

  it("已终止但无 replacement 时应生成并持久化 replacement", async () => {
    const keyId = 1;
    const oldSessionId = "sess_old";
    redisClientRef.mget.mockResolvedValueOnce(["1", null]);

    const { SessionManager } = await import("@/lib/session-manager");

    const sessionId = await SessionManager.getOrCreateSessionId(keyId, [], oldSessionId);

    expect(sessionId).not.toBe(oldSessionId);
    expect(sessionId).toMatch(/^sess_/);

    expect(
      pipelineCalls.some(
        (c) =>
          c[0] === "setex" &&
          c[1] === `session:${oldSessionId}:terminated_replacement` &&
          c[2] === 86400 &&
          c[3] === sessionId
      )
    ).toBe(true);
    expect(
      pipelineCalls.some(
        (c) => c[0] === "expire" && c[1] === `session:${oldSessionId}:terminated` && c[2] === 86400
      )
    ).toBe(true);
  });
});
