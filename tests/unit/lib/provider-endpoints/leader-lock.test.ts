import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getRedisClientMock = vi.fn();

vi.mock("@/lib/redis", () => ({
  getRedisClient: (...args: unknown[]) => getRedisClientMock(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe("provider endpoint leader lock", () => {
  it("fails closed in production when Redis is unavailable", async () => {
    process.env.NODE_ENV = "production";
    getRedisClientMock.mockReturnValue(null);
    const { acquireLeaderLock } = await import("@/lib/provider-endpoints/leader-lock");

    await expect(acquireLeaderLock("locks:test", 1_000)).resolves.toBeNull();
  });

  it("fails closed in production when Redis acquisition throws", async () => {
    process.env.NODE_ENV = "production";
    getRedisClientMock.mockReturnValue({
      status: "ready",
      eval: vi.fn(async () => {
        throw new Error("redis down");
      }),
    });
    const { acquireLeaderLock } = await import("@/lib/provider-endpoints/leader-lock");

    await expect(acquireLeaderLock("locks:test", 1_000)).resolves.toBeNull();
  });

  it("allows memory fallback outside production", async () => {
    process.env.NODE_ENV = "test";
    getRedisClientMock.mockReturnValue(null);
    const { acquireLeaderLock, releaseLeaderLock } = await import(
      "@/lib/provider-endpoints/leader-lock"
    );

    const lock = await acquireLeaderLock("locks:test", 1_000);
    expect(lock).toMatchObject({ key: "locks:test", lockType: "memory" });
    await expect(acquireLeaderLock("locks:test", 1_000)).resolves.toBeNull();
    await releaseLeaderLock(lock!);
    await expect(acquireLeaderLock("locks:test", 1_000)).resolves.toMatchObject({
      lockType: "memory",
    });
  });

  it("keeps Redis lock semantics when the distributed lock is acquired", async () => {
    process.env.NODE_ENV = "production";
    const evalMock = vi.fn(async () => "OK");
    getRedisClientMock.mockReturnValue({ status: "ready", eval: evalMock });
    const { acquireLeaderLock } = await import("@/lib/provider-endpoints/leader-lock");

    await expect(acquireLeaderLock("locks:test", 1_000)).resolves.toMatchObject({
      key: "locks:test",
      lockType: "redis",
    });
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining("SET"),
      1,
      "locks:test",
      expect.any(String),
      "1000"
    );
  });
});
