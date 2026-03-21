import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    trace: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const getRedisClientMock = vi.fn();

vi.mock("@/lib/redis", () => ({
  getRedisClient: getRedisClientMock,
}));

vi.mock("@/app/v1/_lib/proxy/errors", () => ({
  sanitizeHeaders: vi.fn(() => "(empty)"),
  sanitizeUrl: vi.fn((value: string) => value),
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    getActiveSessions: vi.fn(async () => []),
  },
}));

describe("SessionManager.getOrCreateSessionId fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("without client session id, identical messages should not reuse the same derived session id even when Redis is ready", async () => {
    const { SessionManager } = await import("@/lib/session-manager");
    const messages = [{ role: "user", content: "hello" }];
    const hashMapping = new Map<string, string>();

    const pipeline = {
      setex: vi.fn((key: string, _ttl: number, value: string) => {
        hashMapping.set(key, value);
        return pipeline;
      }),
      exec: vi.fn(async () => []),
    };

    getRedisClientMock.mockReturnValue({
      status: "ready",
      get: vi.fn(async (key: string) => hashMapping.get(key) ?? null),
      pipeline: vi.fn(() => pipeline),
    });

    const first = await SessionManager.getOrCreateSessionId(11, messages, null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await SessionManager.getOrCreateSessionId(22, messages, null);

    expect(first).toMatch(/^sess_/);
    expect(second).toMatch(/^sess_/);
    expect(first).not.toBe(second);
  });
});
