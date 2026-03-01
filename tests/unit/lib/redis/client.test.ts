import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = { status: "ready" };
  const mockQuit = vi.fn().mockResolvedValue(undefined);
  const mockDisconnect = vi.fn();
  const mockOn = vi.fn().mockReturnThis();

  const mockInstance = {
    get status() {
      return state.status;
    },
    on: mockOn,
    quit: mockQuit,
    disconnect: mockDisconnect,
  };

  function MockRedisConstructor() {
    return mockInstance;
  }
  MockRedisConstructor.prototype = {};
  const MockRedis = vi.fn(MockRedisConstructor);

  return { MockRedis, mockInstance, mockOn, mockQuit, mockDisconnect, state };
});

vi.mock("ioredis", () => ({ default: mocks.MockRedis }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("server-only", () => ({}));

// eslint-disable-next-line import/order -- must come after vi.mock
import { buildRedisOptionsForUrl, closeRedis, getRedisClient } from "@/lib/redis/client";

describe("buildRedisOptionsForUrl", () => {
  it("detects TLS from rediss:// protocol", () => {
    const result = buildRedisOptionsForUrl("rediss://localhost:6380");
    expect(result.isTLS).toBe(true);
    expect(result.options.tls).toBeDefined();
  });

  it("does not enable TLS for redis:// protocol", () => {
    const result = buildRedisOptionsForUrl("redis://localhost:6379");
    expect(result.isTLS).toBe(false);
    expect(result.options.tls).toBeUndefined();
  });

  it("falls back to string-prefix detection for malformed URLs", () => {
    const result = buildRedisOptionsForUrl("rediss://not a valid url");
    expect(result.isTLS).toBe(true);
  });
});

describe("getRedisClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockOn.mockReturnThis();
    mocks.state.status = "ready";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.ENABLE_RATE_LIMIT = "true";
    delete process.env.NEXT_PHASE;
  });

  afterEach(async () => {
    await closeRedis();
    delete process.env.REDIS_URL;
    delete process.env.ENABLE_RATE_LIMIT;
  });

  it("returns null when REDIS_URL not configured", () => {
    delete process.env.REDIS_URL;
    expect(getRedisClient({ allowWhenRateLimitDisabled: true })).toBeNull();
  });

  it("returns null during production build phase", () => {
    process.env.NEXT_PHASE = "phase-production-build";
    expect(getRedisClient({ allowWhenRateLimitDisabled: true })).toBeNull();
    delete process.env.NEXT_PHASE;
  });

  it("returns null when rate limiting disabled without explicit allow", () => {
    process.env.ENABLE_RATE_LIMIT = "false";
    expect(getRedisClient()).toBeNull();
  });

  it("returns singleton on repeated calls", () => {
    const first = getRedisClient({ allowWhenRateLimitDisabled: true });
    const second = getRedisClient({ allowWhenRateLimitDisabled: true });
    expect(first).toBe(second);
    expect(mocks.MockRedis).toHaveBeenCalledTimes(1);
  });

  it("creates new client when existing singleton has status=end", () => {
    getRedisClient({ allowWhenRateLimitDisabled: true });
    mocks.state.status = "end";
    getRedisClient({ allowWhenRateLimitDisabled: true });
    expect(mocks.MockRedis).toHaveBeenCalledTimes(2);
  });

  it("registers 'end' event listener that resets singleton", () => {
    getRedisClient({ allowWhenRateLimitDisabled: true });
    const endCb = mocks.mockOn.mock.calls.find(([event]) => event === "end")?.[1];
    expect(endCb).toBeDefined();

    endCb();

    mocks.state.status = "ready";
    getRedisClient({ allowWhenRateLimitDisabled: true });
    expect(mocks.MockRedis).toHaveBeenCalledTimes(2);
  });
});

describe("closeRedis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockOn.mockReturnThis();
    mocks.mockQuit.mockResolvedValue(undefined);
    mocks.state.status = "ready";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.ENABLE_RATE_LIMIT = "true";
    delete process.env.NEXT_PHASE;
  });

  afterEach(async () => {
    await closeRedis();
    delete process.env.REDIS_URL;
    delete process.env.ENABLE_RATE_LIMIT;
  });

  it("is a no-op when no client exists", async () => {
    await expect(closeRedis()).resolves.toBeUndefined();
    expect(mocks.mockQuit).not.toHaveBeenCalled();
  });

  it("calls quit and resets singleton", async () => {
    getRedisClient({ allowWhenRateLimitDisabled: true });
    await closeRedis();

    expect(mocks.mockQuit).toHaveBeenCalled();
    getRedisClient({ allowWhenRateLimitDisabled: true });
    expect(mocks.MockRedis).toHaveBeenCalledTimes(2);
  });

  it("falls back to disconnect when quit throws", async () => {
    mocks.mockQuit.mockRejectedValueOnce(new Error("quit failed"));
    getRedisClient({ allowWhenRateLimitDisabled: true });

    await closeRedis();

    expect(mocks.mockDisconnect).toHaveBeenCalled();
  });

  it("skips quit when client status is already 'end'", async () => {
    getRedisClient({ allowWhenRateLimitDisabled: true });
    mocks.state.status = "end";

    await closeRedis();

    expect(mocks.mockQuit).not.toHaveBeenCalled();
  });
});
