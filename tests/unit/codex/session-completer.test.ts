import { beforeEach, describe, expect, test, vi } from "vitest";

let redisClientRef: any = null;

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ORIGINAL_SESSION_TTL = process.env.SESSION_TTL;

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisClientRef,
}));

function makeCodexRequestBody(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    model: "gpt-5-codex",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    ],
    ...(overrides ?? {}),
  };
}

function makeFakeRedis() {
  const store = new Map<string, string>();

  const client = {
    status: "ready",
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(
      async (key: string, value: string, mode?: string, ttlSeconds?: number, nx?: string) => {
        if (mode !== "EX" || typeof ttlSeconds !== "number") {
          throw new Error("FakeRedis only supports SET key value EX ttl [NX]");
        }

        if (nx === "NX" && store.has(key)) {
          return null;
        }

        store.set(key, value);
        return "OK";
      }
    ),
  };

  return { client, store };
}

describe("Codex session completer", () => {
  beforeEach(() => {
    redisClientRef = null;
    if (ORIGINAL_SESSION_TTL === undefined) {
      delete process.env.SESSION_TTL;
    } else {
      process.env.SESSION_TTL = ORIGINAL_SESSION_TTL;
    }
  });

  test("completes body.prompt_cache_key from header session_id", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    const sessionId = "sess_123456789012345678901";
    const headers = new Headers({ session_id: sessionId });
    const body = makeCodexRequestBody();

    const result = await completeCodexSessionIdentifiers({
      keyId: 1,
      headers,
      requestBody: body,
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(result.applied).toBe(true);
    expect(result.sessionId).toBe(sessionId);
    expect(body.prompt_cache_key).toBe(sessionId);
    expect(body.metadata).toBeUndefined();
    expect(headers.get("session_id")).toBe(sessionId);
  });

  test("completes header session_id from body.prompt_cache_key", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    const promptCacheKey = "019b82ff-08ff-75a3-a203-7e10274fdbd8";
    const headers = new Headers();
    const body = makeCodexRequestBody({ prompt_cache_key: promptCacheKey });

    const result = await completeCodexSessionIdentifiers({
      keyId: 1,
      headers,
      requestBody: body,
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(result.applied).toBe(true);
    expect(result.sessionId).toBe(promptCacheKey);
    expect(headers.get("session_id")).toBe(promptCacheKey);
    expect(body.prompt_cache_key).toBe(promptCacheKey);
    expect(body.metadata).toBeUndefined();
  });

  test("no-op when both session_id and prompt_cache_key already exist", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    const sessionId = "sess_123456789012345678901";
    const headers = new Headers({ session_id: sessionId });
    const body = makeCodexRequestBody({ prompt_cache_key: sessionId });

    const result = await completeCodexSessionIdentifiers({
      keyId: 1,
      headers,
      requestBody: body,
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(result.applied).toBe(false);
    expect(result.sessionId).toBe(sessionId);
    expect(headers.get("session_id")).toBe(sessionId);
    expect(body.prompt_cache_key).toBe(sessionId);
  });

  test("generates a UUID v7 when both identifiers are missing and Redis is unavailable", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    const headers = new Headers();
    const body = makeCodexRequestBody();

    const result = await completeCodexSessionIdentifiers({
      keyId: 1,
      headers,
      requestBody: body,
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(result.applied).toBe(true);
    expect(result.action).toBe("generated_uuid_v7");
    expect(result.sessionId).toMatch(UUID_V7_PATTERN);
    expect(headers.get("session_id")).toBe(result.sessionId);
    expect(body.prompt_cache_key).toBe(result.sessionId);
    expect(body.metadata).toBeUndefined();
  });

  test("reuses the same generated session id for the same fingerprint when Redis is available", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    const { client: fakeRedis } = makeFakeRedis();
    redisClientRef = fakeRedis;

    const baseHeaders = new Headers({
      "x-forwarded-for": "203.0.113.10",
      "user-agent": "codex_cli_rs/0.50.0",
    });

    const first = await completeCodexSessionIdentifiers({
      keyId: 123,
      headers: new Headers(baseHeaders),
      requestBody: makeCodexRequestBody(),
      userAgent: "codex_cli_rs/0.50.0",
    });

    const second = await completeCodexSessionIdentifiers({
      keyId: 123,
      headers: new Headers(baseHeaders),
      requestBody: makeCodexRequestBody(),
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(first.action).toBe("generated_uuid_v7");
    expect(second.action).toBe("reused_fingerprint_cache");
    expect(first.sessionId).toBe(second.sessionId);
    expect(first.sessionId).toMatch(UUID_V7_PATTERN);
  });

  test("completes header session_id when only x-session-id is provided", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    const xSessionId = "sess_123456789012345678902";
    const headers = new Headers({ "x-session-id": xSessionId });
    const body = makeCodexRequestBody();

    const result = await completeCodexSessionIdentifiers({
      keyId: 1,
      headers,
      requestBody: body,
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(result.applied).toBe(true);
    expect(result.sessionId).toBe(xSessionId);
    expect(headers.get("session_id")).toBe(xSessionId);
    expect(headers.get("x-session-id")).toBe(xSessionId);
    expect(body.prompt_cache_key).toBe(xSessionId);
    expect(body.metadata).toBeUndefined();
  });

  test("completes canonical session_id when x-session-id and prompt_cache_key are provided", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    const xSessionId = "sess_123456789012345678904";
    const headers = new Headers({ "x-session-id": xSessionId });
    const body = makeCodexRequestBody({ prompt_cache_key: xSessionId });

    const result = await completeCodexSessionIdentifiers({
      keyId: 1,
      headers,
      requestBody: body,
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(result.applied).toBe(true);
    expect(result.action).toBe("completed_missing_fields");
    expect(result.sessionId).toBe(xSessionId);
    expect(headers.get("session_id")).toBe(xSessionId);
    expect(headers.get("x-session-id")).toBe(xSessionId);
    expect(body.prompt_cache_key).toBe(xSessionId);
    expect(body.metadata).toBeUndefined();
  });

  test("does not mutate metadata when metadata exists (metadata is not allowed for Codex upstream)", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    const sessionId = "sess_123456789012345678903";
    const headers = new Headers({ session_id: sessionId });
    const metadata = { session_id: "sess_aaaaaaaaaaaaaaaaaaaaa", other: "value" };
    const body = makeCodexRequestBody({
      metadata,
    });

    const result = await completeCodexSessionIdentifiers({
      keyId: 1,
      headers,
      requestBody: body,
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(result.applied).toBe(true);
    expect(result.action).toBe("completed_missing_fields");
    expect(body.metadata).toEqual(metadata);
  });

  test("uses x-real-ip when x-forwarded-for is absent (fingerprint stability)", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    const { client: fakeRedis } = makeFakeRedis();
    redisClientRef = fakeRedis;

    const headers = new Headers({
      "x-real-ip": "198.51.100.7",
      "user-agent": "codex_cli_rs/0.50.0",
    });

    const first = await completeCodexSessionIdentifiers({
      keyId: 999,
      headers: new Headers(headers),
      requestBody: makeCodexRequestBody(),
      userAgent: "codex_cli_rs/0.50.0",
    });

    const second = await completeCodexSessionIdentifiers({
      keyId: 999,
      headers: new Headers(headers),
      requestBody: makeCodexRequestBody(),
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(first.action).toBe("generated_uuid_v7");
    expect(second.action).toBe("reused_fingerprint_cache");
    expect(first.sessionId).toBe(second.sessionId);
  });

  test("fingerprint skips non-message items and supports string content", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    const { client: fakeRedis } = makeFakeRedis();
    redisClientRef = fakeRedis;

    const body = makeCodexRequestBody({
      input: [
        { type: "function_call", call_id: "call_123", name: "tool", arguments: "{}" },
        { type: "message", role: "user", content: "hello from string content" },
      ],
    });

    const result = await completeCodexSessionIdentifiers({
      keyId: 321,
      headers: new Headers({ "x-forwarded-for": "203.0.113.99" }),
      requestBody: body,
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(result.action).toBe("generated_uuid_v7");
    expect(result.sessionId).toMatch(UUID_V7_PATTERN);
  });

  test("does not overwrite non-object metadata", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    const body = makeCodexRequestBody({ metadata: "not-an-object" });
    const result = await completeCodexSessionIdentifiers({
      keyId: 1,
      headers: new Headers(),
      requestBody: body,
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(result.sessionId).toMatch(UUID_V7_PATTERN);
    expect(body.metadata).toBe("not-an-object");
  });

  test("handles Redis NX race by re-reading existing value", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    const existing = "019b82ff-08ff-75a3-a203-7e10274fdbd8";
    let sawFirstGet = false;

    redisClientRef = {
      status: "ready",
      get: vi.fn(async () => {
        if (!sawFirstGet) {
          sawFirstGet = true;
          return null;
        }
        return existing;
      }),
      set: vi.fn(async (_key: string, _value: string, _ex: string, _ttl: number, nx?: string) => {
        // Simulate another request writing between GET and SET NX
        if (nx === "NX") return null;
        return "OK";
      }),
    };

    const result = await completeCodexSessionIdentifiers({
      keyId: 1,
      headers: new Headers({ "x-forwarded-for": "203.0.113.10" }),
      requestBody: makeCodexRequestBody(),
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(result.action).toBe("reused_fingerprint_cache");
    expect(result.sessionId).toBe(existing);
  });

  test("fingerprint treats empty input as unknown and still reuses stable session id", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    const { client: fakeRedis } = makeFakeRedis();
    redisClientRef = fakeRedis;

    const headers = new Headers({
      "x-forwarded-for": "203.0.113.77",
      "user-agent": "codex_cli_rs/0.50.0",
    });

    const first = await completeCodexSessionIdentifiers({
      keyId: 42,
      headers: new Headers(headers),
      requestBody: makeCodexRequestBody({ input: [] }),
      userAgent: "codex_cli_rs/0.50.0",
    });

    const second = await completeCodexSessionIdentifiers({
      keyId: 42,
      headers: new Headers(headers),
      requestBody: makeCodexRequestBody({ input: [] }),
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(first.action).toBe("generated_uuid_v7");
    expect(second.action).toBe("reused_fingerprint_cache");
    expect(first.sessionId).toBe(second.sessionId);
  });

  test("fingerprint only uses first 3 message texts (extra messages do not affect reuse)", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    const { client: fakeRedis } = makeFakeRedis();
    redisClientRef = fakeRedis;

    const headers = new Headers({
      "x-forwarded-for": "203.0.113.88",
      "user-agent": "codex_cli_rs/0.50.0",
    });

    const firstBody = makeCodexRequestBody({
      input: [
        { type: "message", role: "user", content: "m1" },
        { type: "message", role: "user", content: "m2" },
        { type: "message", role: "user", content: "m3" },
        { type: "message", role: "user", content: "m4-first" },
      ],
    });

    const secondBody = makeCodexRequestBody({
      input: [
        { type: "message", role: "user", content: "m1" },
        { type: "message", role: "user", content: "m2" },
        { type: "message", role: "user", content: "m3" },
        { type: "message", role: "user", content: "m4-changed" },
      ],
    });

    const first = await completeCodexSessionIdentifiers({
      keyId: 43,
      headers: new Headers(headers),
      requestBody: firstBody,
      userAgent: "codex_cli_rs/0.50.0",
    });

    const second = await completeCodexSessionIdentifiers({
      keyId: 43,
      headers: new Headers(headers),
      requestBody: secondBody,
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(first.action).toBe("generated_uuid_v7");
    expect(second.action).toBe("reused_fingerprint_cache");
    expect(first.sessionId).toBe(second.sessionId);
  });

  test("handles Redis NX fallback by setting without NX when second read is still missing", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    redisClientRef = {
      status: "ready",
      get: vi.fn(async () => null),
      set: vi.fn(async (_key: string, _value: string, _ex: string, _ttl: number, nx?: string) => {
        if (nx === "NX") return null;
        return "OK";
      }),
    };

    const result = await completeCodexSessionIdentifiers({
      keyId: 1,
      headers: new Headers({ "x-forwarded-for": "203.0.113.10" }),
      requestBody: makeCodexRequestBody(),
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(result.action).toBe("generated_uuid_v7");
    expect(result.sessionId).toMatch(UUID_V7_PATTERN);
    expect(redisClientRef.set).toHaveBeenCalledTimes(2);
    expect(redisClientRef.set.mock.calls[0]?.[4]).toBe("NX");
    expect(redisClientRef.set.mock.calls[1]?.[4]).toBeUndefined();
  });

  test("falls back to UUID v7 when Redis throws", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );
    const { logger } = await import("@/lib/logger");

    redisClientRef = {
      status: "ready",
      get: vi.fn(async () => {
        throw new Error("boom");
      }),
      set: vi.fn(async () => "OK"),
    };

    const result = await completeCodexSessionIdentifiers({
      keyId: 1,
      headers: new Headers({ "x-forwarded-for": "203.0.113.10" }),
      requestBody: makeCodexRequestBody(),
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(result.action).toBe("generated_uuid_v7");
    expect(result.sessionId).toMatch(UUID_V7_PATTERN);
    expect(logger.warn).toHaveBeenCalled();
  });

  test("uses SESSION_TTL when it is a valid integer", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    process.env.SESSION_TTL = "600";

    const { client: fakeRedis } = makeFakeRedis();
    redisClientRef = fakeRedis;

    const result = await completeCodexSessionIdentifiers({
      keyId: 1,
      headers: new Headers({ "x-forwarded-for": "203.0.113.10" }),
      requestBody: makeCodexRequestBody(),
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(result.sessionId).toMatch(UUID_V7_PATTERN);
  });

  test("treats invalid session_id as missing and generates a new one", async () => {
    const { completeCodexSessionIdentifiers } = await import(
      "@/app/v1/_lib/codex/session-completer"
    );

    const headers = new Headers({ session_id: "short_id_12345" });
    const body = makeCodexRequestBody();

    const result = await completeCodexSessionIdentifiers({
      keyId: 1,
      headers,
      requestBody: body,
      userAgent: "codex_cli_rs/0.50.0",
    });

    expect(result.sessionId).not.toBe("short_id_12345");
    expect(result.sessionId).toMatch(UUID_V7_PATTERN);
    expect(headers.get("session_id")).toBe(result.sessionId);
    expect(body.prompt_cache_key).toBe(result.sessionId);
  });
});
