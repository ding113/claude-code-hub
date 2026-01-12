import { beforeEach, describe, expect, test, vi } from "vitest";

type RedisLike = {
  status: string;
  get: (key: string) => Promise<string | null>;
  setex: (key: string, ttlSeconds: number, value: string) => Promise<unknown>;
  expire: (key: string, ttlSeconds: number) => Promise<unknown>;
};

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();

  const redis: RedisLike = {
    status: "ready",
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    setex: vi.fn(async (key: string, _ttlSeconds: number, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    expire: vi.fn(async () => 1),
  };

  return {
    store,
    redis,
    getRedisClient: vi.fn(() => redis),
  };
});

vi.mock("@/lib/redis", () => ({
  getRedisClient: mocks.getRedisClient,
}));

import { CodexSessionIdCompleter, generateUuidV7 } from "@/app/v1/_lib/codex/session-completer";

const VALID_SESSION_ID = "019b82ff-08ff-75a3-a203-7e10274fdbd8";
const OTHER_VALID_SESSION_ID = "019aa041-db00-7df0-af17-f34c7695d024";

function createBaseCodexBody(text: string): Record<string, unknown> {
  return {
    model: "gpt-5-codex",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    ],
  };
}

describe("CodexSessionIdCompleter", () => {
  beforeEach(() => {
    mocks.store.clear();
    vi.clearAllMocks();
  });

  test("completes prompt_cache_key from existing session_id header", async () => {
    const headers = new Headers({
      session_id: VALID_SESSION_ID,
      "user-agent": "codex_cli_rs/0.50.0",
      "x-real-ip": "1.2.3.4",
    });
    const body = createBaseCodexBody("hello");

    const result = await CodexSessionIdCompleter.complete(1, headers, body);

    expect(result.applied).toBe(true);
    expect(result.action).toBe("copied_header_to_body");
    expect(headers.get("session_id")).toBe(VALID_SESSION_ID);
    expect(headers.get("x-session-id")).toBe(VALID_SESSION_ID);
    expect(body.prompt_cache_key).toBe(VALID_SESSION_ID);
    expect((body.metadata as any)?.session_id).toBe(VALID_SESSION_ID);
  });

  test("completes session_id header from existing prompt_cache_key", async () => {
    const headers = new Headers({
      "user-agent": "codex_cli_rs/0.50.0",
      "x-real-ip": "1.2.3.4",
    });
    const body = { ...createBaseCodexBody("hello"), prompt_cache_key: VALID_SESSION_ID };

    const result = await CodexSessionIdCompleter.complete(1, headers, body);

    expect(result.applied).toBe(true);
    expect(result.action).toBe("copied_body_to_header");
    expect(headers.get("session_id")).toBe(VALID_SESSION_ID);
    expect(headers.get("x-session-id")).toBe(VALID_SESSION_ID);
    expect(body.prompt_cache_key).toBe(VALID_SESSION_ID);
    expect((body.metadata as any)?.session_id).toBe(VALID_SESSION_ID);
  });

  test("noop when both prompt_cache_key and session_id are present and consistent", async () => {
    const headers = new Headers({
      session_id: VALID_SESSION_ID,
      "user-agent": "codex_cli_rs/0.50.0",
      "x-real-ip": "1.2.3.4",
    });
    const body = { ...createBaseCodexBody("hello"), prompt_cache_key: VALID_SESSION_ID };

    const result = await CodexSessionIdCompleter.complete(1, headers, body);

    expect(result.applied).toBe(false);
    expect(result.action).toBe("noop");
    expect(headers.get("session_id")).toBe(VALID_SESSION_ID);
    expect(body.prompt_cache_key).toBe(VALID_SESSION_ID);
    expect(body.metadata).toBeUndefined();
  });

  test("aligns mismatch by preferring header session_id", async () => {
    const headers = new Headers({
      session_id: VALID_SESSION_ID,
      "user-agent": "codex_cli_rs/0.50.0",
      "x-real-ip": "1.2.3.4",
    });
    const body = { ...createBaseCodexBody("hello"), prompt_cache_key: OTHER_VALID_SESSION_ID };

    const result = await CodexSessionIdCompleter.complete(1, headers, body);

    expect(result.applied).toBe(true);
    expect(result.action).toBe("aligned_mismatch");
    expect(headers.get("session_id")).toBe(VALID_SESSION_ID);
    expect(headers.get("x-session-id")).toBe(VALID_SESSION_ID);
    expect(body.prompt_cache_key).toBe(VALID_SESSION_ID);
    expect((body.metadata as any)?.session_id).toBe(VALID_SESSION_ID);
  });

  test("generates UUID v7 when both are missing and reuses via fingerprint", async () => {
    const headers1 = new Headers({
      "user-agent": "codex_cli_rs/0.50.0",
      "x-real-ip": "1.2.3.4",
    });
    const body1 = createBaseCodexBody("hello");

    const first = await CodexSessionIdCompleter.complete(1, headers1, body1);

    expect(first.applied).toBe(true);
    expect(first.action).toBe("generated");
    expect(first.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(first.redis.used).toBe(true);
    expect(first.redis.hit).toBe(false);
    expect(body1.prompt_cache_key).toBe(first.sessionId);
    expect(headers1.get("session_id")).toBe(first.sessionId);

    const headers2 = new Headers({
      "user-agent": "codex_cli_rs/0.50.0",
      "x-real-ip": "1.2.3.4",
    });
    const body2 = createBaseCodexBody("hello");

    const second = await CodexSessionIdCompleter.complete(1, headers2, body2);

    expect(second.action).toBe("generated");
    expect(second.redis.used).toBe(true);
    expect(second.redis.hit).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
    expect(body2.prompt_cache_key).toBe(first.sessionId);
    expect(headers2.get("session_id")).toBe(first.sessionId);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  test("treats invalid session_id as missing and generates a new one", async () => {
    const headers = new Headers({
      session_id: "short",
      "user-agent": "codex_cli_rs/0.50.0",
      "x-real-ip": "1.2.3.4",
    });
    const body = createBaseCodexBody("hello");

    const result = await CodexSessionIdCompleter.complete(1, headers, body);

    expect(result.action).toBe("generated");
    expect(headers.get("session_id")).not.toBe("short");
    expect(body.prompt_cache_key).toBe(headers.get("session_id"));
  });

  test("falls back to local generation when Redis is unavailable", async () => {
    mocks.getRedisClient.mockReturnValueOnce(null);
    mocks.getRedisClient.mockReturnValueOnce(null);

    const headers1 = new Headers({
      "user-agent": "codex_cli_rs/0.50.0",
      "x-real-ip": "1.2.3.4",
    });
    const body1 = createBaseCodexBody("hello");

    const first = await CodexSessionIdCompleter.complete(1, headers1, body1);

    const headers2 = new Headers({
      "user-agent": "codex_cli_rs/0.50.0",
      "x-real-ip": "1.2.3.4",
    });
    const body2 = createBaseCodexBody("hello");

    const second = await CodexSessionIdCompleter.complete(1, headers2, body2);

    expect(first.redis.used).toBe(false);
    expect(second.redis.used).toBe(false);
    expect(first.sessionId).not.toBeNull();
    expect(second.sessionId).not.toBeNull();
    expect(second.sessionId).not.toBe(first.sessionId);
  });
});

describe("generateUuidV7", () => {
  test("returns UUID v7 string format", () => {
    const id = generateUuidV7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
