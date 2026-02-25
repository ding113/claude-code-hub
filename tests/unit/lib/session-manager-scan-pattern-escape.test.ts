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

describe("SessionManager.hasAnySessionMessages - scan pattern escaping", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();

    redisClientRef = {
      status: "ready",
      exists: vi.fn(async () => 0),
      scan: vi.fn(async () => ["0", []]),
    };
  });

  it("应对 sessionId 中的 glob 特殊字符进行转义（避免误匹配/误删）", async () => {
    const { SessionManager } = await import("@/lib/session-manager");

    const sessionId = "sess_te*st?[x]";
    const ok = await SessionManager.hasAnySessionMessages(sessionId);

    expect(ok).toBe(false);
    expect(redisClientRef.exists).toHaveBeenCalledWith(`session:${sessionId}:messages`);
    expect(redisClientRef.scan).toHaveBeenCalledWith(
      "0",
      "MATCH",
      "session:sess_te\\*st\\?\\[x\\]:req:*:messages",
      "COUNT",
      100
    );
  });
});
