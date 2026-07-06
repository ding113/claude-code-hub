import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Shared REDIS_URL parsing for the Bull-backed queues (cleanup / notification).
 *
 * Regression coverage:
 * - percent-encoded userinfo must be decoded (WHATWG URL does not decode it)
 * - a raw "%" that is not a valid escape sequence must fall back to the raw
 *   string instead of throwing URIError at container startup (the pre-decode
 *   behavior accepted such passwords, so failing startup is a regression)
 * - the /N path selects the Bull DB index, aligned with ioredis parseURL
 */

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  delete process.env.REDIS_TLS_REJECT_UNAUTHORIZED;
});

describe("buildRedisQueueOptions", () => {
  it("decodes percent-encoded userinfo", async () => {
    const { buildRedisQueueOptions } = await import("@/lib/redis/bull-queue-options");

    const options = buildRedisQueueOptions(
      "redis://user%40name:pass%2Fword%3D@redis.example.com:6380/15",
      "[Test]"
    );

    expect(options).toMatchObject({
      host: "redis.example.com",
      port: 6380,
      username: "user@name",
      password: "pass/word=",
      db: 15,
    });
  });

  it("falls back to the raw value when userinfo contains an invalid escape", async () => {
    const { buildRedisQueueOptions } = await import("@/lib/redis/bull-queue-options");

    // raw % not followed by two hex digits: decodeURIComponent would throw URIError
    const options = buildRedisQueueOptions("redis://:pass%word@localhost:6379", "[Test]");

    expect(options.password).toBe("pass%word");
  });

  it("defaults port to 6379 and omits db when the path has no index", async () => {
    const { buildRedisQueueOptions } = await import("@/lib/redis/bull-queue-options");

    const options = buildRedisQueueOptions("redis://localhost", "[Test]");

    expect(options.port).toBe(6379);
    expect(options.db).toBeUndefined();
  });

  it("configures TLS with SNI for rediss:// and honors REDIS_TLS_REJECT_UNAUTHORIZED", async () => {
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED = "false";
    const { buildRedisQueueOptions } = await import("@/lib/redis/bull-queue-options");

    const options = buildRedisQueueOptions("rediss://:secret@redis.cloud.example:6380", "[Test]");

    expect(options.tls).toEqual({
      host: "redis.cloud.example",
      servername: "redis.cloud.example",
      rejectUnauthorized: false,
    });
  });

  it("throws on an unparseable URL", async () => {
    const { buildRedisQueueOptions } = await import("@/lib/redis/bull-queue-options");

    expect(() => buildRedisQueueOptions("not a url", "[Test]")).toThrow(
      "Invalid REDIS_URL format"
    );
  });
});
