import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const loggerMock = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/logger", () => ({ logger: loggerMock }));

const sanitizeHeadersMock = vi.fn((headers: Headers) => {
  return Array.from(headers.entries())
    .map(([key, value]) => `${key}: ${key === "authorization" ? "[REDACTED]" : value}`)
    .join("\n");
});

const sanitizeUrlMock = vi.fn((url: unknown) => String(url));

vi.mock("@/app/v1/_lib/proxy/errors", () => ({
  sanitizeHeaders: sanitizeHeadersMock,
  sanitizeUrl: sanitizeUrlMock,
}));

const redisStore = new Map<string, string>();
const pipelineSetexMock = vi.fn().mockReturnThis();
const pipelineHsetMock = vi.fn().mockReturnThis();
const pipelineExpireMock = vi.fn().mockReturnThis();
const pipelineDelMock = vi.fn().mockReturnThis();
const pipelineExecMock = vi.fn().mockResolvedValue([]);
const redisPipeline = {
  setex: pipelineSetexMock,
  hset: pipelineHsetMock,
  expire: pipelineExpireMock,
  del: pipelineDelMock,
  exec: pipelineExecMock,
};
const redisMock = {
  status: "ready",
  setex: vi.fn((key: string, _ttl: number, value: string) => {
    redisStore.set(key, value);
    return Promise.resolve("OK");
  }),
  get: vi.fn((key: string) => Promise.resolve(redisStore.get(key) ?? null)),
  set: vi.fn().mockResolvedValue("OK"),
  expire: vi.fn().mockResolvedValue(1),
  incr: vi.fn().mockResolvedValue(1),
  eval: vi.fn().mockResolvedValue(1),
  pipeline: vi.fn(() => redisPipeline),
};

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisMock,
}));

let mockStoreMessages = false;
let mockStoreSessionResponseBody = true;

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => ({
    STORE_SESSION_MESSAGES: mockStoreMessages,
    STORE_SESSION_RESPONSE_BODY: mockStoreSessionResponseBody,
    SESSION_TTL: 300,
  }),
}));

const { SessionManager } = await import("@/lib/session-manager");

describe("SessionManager detail snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisStore.clear();
    redisMock.status = "ready";
    mockStoreMessages = false;
    mockStoreSessionResponseBody = true;
  });

  it("atomically persists the request sequence while expiring its owner marker", async () => {
    redisMock.eval.mockResolvedValueOnce(1);

    await expect(SessionManager.getNextRequestSequence("sess_owner", 42)).resolves.toBe(1);

    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('PERSIST', KEYS[1])"),
      1,
      "session:sess_owner:seq",
      "session:sess_owner:req:",
      "300",
      "42"
    );
    expect(redisMock.incr).not.toHaveBeenCalled();
    expect(redisMock.pipeline).not.toHaveBeenCalled();
  });

  it("validates request artifacts against their immutable key owner", async () => {
    redisStore.set("session:sess_owner:req:1:owner", "42");

    await expect(SessionManager.isSessionRequestOwnedByKey("sess_owner", 1, 42)).resolves.toBe(
      true
    );
    await expect(SessionManager.isSessionRequestOwnedByKey("sess_owner", 1, 43)).resolves.toBe(
      false
    );
    await expect(SessionManager.isSessionRequestOwnedByKey("sess_owner", 2, 42)).resolves.toBe(
      false
    );
  });

  it("fails request artifact ownership checks closed when Redis is unavailable", async () => {
    redisMock.status = "end";

    await expect(SessionManager.isSessionRequestOwnedByKey("sess_owner", 1, 42)).resolves.toBe(
      false
    );
    expect(redisMock.get).not.toHaveBeenCalled();
  });

  it("refreshes the request owner when a late response snapshot is stored", async () => {
    await SessionManager.storeSessionResponsePhaseSnapshot(
      "sess_late_response",
      "after",
      { body: "late response" },
      7,
      42
    );

    expect(redisMock.setex).toHaveBeenCalledWith(
      "session:sess_late_response:req:7:owner",
      300,
      "42"
    );
  });

  it("does not use legacy messages for a missing scoped request", async () => {
    redisStore.set(
      "session:sess_scoped_messages:messages",
      JSON.stringify([{ role: "user", content: "legacy" }])
    );

    await expect(SessionManager.getSessionMessages("sess_scoped_messages", 7)).resolves.toBeNull();
    await expect(SessionManager.getSessionMessages("sess_scoped_messages")).resolves.toEqual([
      { role: "user", content: "legacy" },
    ]);
  });

  it("does not use legacy response for a missing scoped request", async () => {
    redisStore.set("session:sess_scoped_response:response", "legacy response");

    await expect(SessionManager.getSessionResponse("sess_scoped_response", 7)).resolves.toBeNull();
    await expect(SessionManager.getSessionResponse("sess_scoped_response")).resolves.toBe(
      "legacy response"
    );
  });

  it("stores and retrieves request/response before-after snapshots with TTL and redaction", async () => {
    await SessionManager.storeSessionRequestPhaseSnapshot(
      "sess_snap",
      "before",
      {
        body: {
          model: "gpt-5.5",
          messages: [{ role: "user", content: "top secret request" }],
        },
        messages: [{ role: "user", content: "top secret request" }],
        headers: new Headers({
          authorization: "Bearer secret-token",
          "content-type": "application/json",
        }),
        meta: {
          clientUrl: "https://client.example/v1/messages",
          upstreamUrl: null,
          method: "POST",
        },
      },
      1
    );

    await SessionManager.storeSessionRequestPhaseSnapshot(
      "sess_snap",
      "after",
      {
        body: JSON.stringify({
          model: "gpt-5.5",
          messages: [{ role: "user", content: "processed request body" }],
        }),
        headers: new Headers({
          authorization: "Bearer upstream-secret",
          "x-provider": "anthropic",
        }),
        meta: {
          clientUrl: null,
          upstreamUrl: "https://upstream.example/v1/messages",
          method: "POST",
        },
      },
      1
    );

    await SessionManager.storeSessionResponsePhaseSnapshot(
      "sess_snap",
      "before",
      {
        body: JSON.stringify({
          content: [{ type: "text", text: "raw upstream response" }],
        }),
        headers: new Headers({
          authorization: "Bearer response-secret",
          "x-upstream": "1",
        }),
        meta: {
          upstreamUrl: "https://upstream.example/v1/messages",
          statusCode: 200,
        },
      },
      1
    );

    await SessionManager.storeSessionResponsePhaseSnapshot(
      "sess_snap",
      "after",
      {
        body: JSON.stringify({
          content: [{ type: "text", text: "final client response" }],
        }),
        headers: new Headers({
          "content-type": "application/json",
          "x-client-visible": "1",
        }),
        meta: {
          upstreamUrl: null,
          statusCode: 200,
        },
      },
      1
    );

    const requestBefore = await SessionManager.getSessionRequestPhaseSnapshot(
      "sess_snap",
      "before",
      1
    );
    const requestAfter = await SessionManager.getSessionRequestPhaseSnapshot(
      "sess_snap",
      "after",
      1
    );
    const responseBefore = await SessionManager.getSessionResponsePhaseSnapshot(
      "sess_snap",
      "before",
      1
    );
    const responseAfter = await SessionManager.getSessionResponsePhaseSnapshot(
      "sess_snap",
      "after",
      1
    );

    expect(requestBefore).toEqual({
      body: {
        model: "gpt-5.5",
        messages: [{ role: "user", content: "[REDACTED]" }],
      },
      messages: [{ role: "user", content: "[REDACTED]" }],
      headers: {
        authorization: "[REDACTED]",
        "content-type": "application/json",
      },
      meta: {
        clientUrl: "https://client.example/v1/messages",
        upstreamUrl: null,
        method: "POST",
      },
    });

    expect(requestAfter).toEqual({
      body: {
        model: "gpt-5.5",
        messages: [{ role: "user", content: "[REDACTED]" }],
      },
      messages: null,
      headers: {
        authorization: "[REDACTED]",
        "x-provider": "anthropic",
      },
      meta: {
        clientUrl: null,
        upstreamUrl: "https://upstream.example/v1/messages",
        method: "POST",
      },
    });

    expect(responseBefore).toEqual({
      body: JSON.stringify({
        content: [{ type: "text", text: "[REDACTED]" }],
      }),
      headers: {
        authorization: "[REDACTED]",
        "x-upstream": "1",
      },
      meta: {
        upstreamUrl: "https://upstream.example/v1/messages",
        statusCode: 200,
      },
    });

    expect(responseAfter).toEqual({
      body: JSON.stringify({
        content: [{ type: "text", text: "[REDACTED]" }],
      }),
      headers: {
        "content-type": "application/json",
        "x-client-visible": "1",
      },
      meta: {
        upstreamUrl: null,
        statusCode: 200,
      },
    });

    const keys = redisMock.setex.mock.calls.map((call) => call[0]);
    expect(keys).toContain("session:sess_snap:req:1:snapshot:request:before:body");
    expect(keys).toContain("session:sess_snap:req:1:snapshot:request:before:messages");
    expect(keys).toContain("session:sess_snap:req:1:snapshot:request:after:headers");
    expect(keys).toContain("session:sess_snap:req:1:snapshot:response:before:meta");
    expect(keys).toContain("session:sess_snap:req:1:snapshot:response:after:body");
    expect(redisMock.setex.mock.calls.every((call) => call[1] === 300)).toBe(true);
  });

  it("returns null when a specific phase snapshot is absent", async () => {
    await SessionManager.storeSessionRequestPhaseSnapshot(
      "sess_missing",
      "before",
      {
        body: { messages: [{ role: "user", content: "hello" }] },
        meta: {
          clientUrl: "https://client.example/v1/messages",
          upstreamUrl: null,
          method: "POST",
        },
      },
      1
    );

    expect(
      await SessionManager.getSessionRequestPhaseSnapshot("sess_missing", "after", 1)
    ).toBeNull();
    expect(
      await SessionManager.getSessionResponsePhaseSnapshot("sess_missing", "before", 1)
    ).toBeNull();
    expect(
      await SessionManager.getSessionRequestPhaseSnapshot("sess_missing", "before", 1)
    ).toEqual({
      body: { messages: [{ role: "user", content: "[REDACTED]" }] },
      messages: null,
      headers: null,
      meta: {
        clientUrl: "https://client.example/v1/messages",
        upstreamUrl: null,
        method: "POST",
      },
    });
  });

  it("skips response body snapshot when STORE_SESSION_RESPONSE_BODY=false", async () => {
    mockStoreSessionResponseBody = false;

    await SessionManager.storeSessionResponsePhaseSnapshot(
      "sess_no_response_body",
      "after",
      {
        body: '{"secret":true}',
        headers: new Headers({ "content-type": "application/json" }),
        meta: { upstreamUrl: null, statusCode: 200 },
      },
      1
    );

    expect(redisMock.setex).not.toHaveBeenCalledWith(
      "session:sess_no_response_body:req:1:snapshot:response:after:body",
      expect.anything(),
      expect.anything()
    );
    expect(
      await SessionManager.getSessionResponsePhaseSnapshot("sess_no_response_body", "after", 1)
    ).toEqual({
      body: null,
      headers: { "content-type": "application/json" },
      meta: { upstreamUrl: null, statusCode: 200 },
    });
  });

  it("treats empty headers as missing instead of an empty record", async () => {
    await SessionManager.storeSessionRequestPhaseSnapshot(
      "sess_empty_headers",
      "after",
      {
        body: { model: "gpt-5.5" },
        headers: new Headers(),
        meta: {
          clientUrl: null,
          upstreamUrl: "https://upstream.example/v1/responses",
          method: "POST",
        },
      },
      1
    );

    expect(
      await SessionManager.getSessionRequestPhaseSnapshot("sess_empty_headers", "after", 1)
    ).toEqual({
      body: { model: "gpt-5.5" },
      messages: null,
      headers: null,
      meta: {
        clientUrl: null,
        upstreamUrl: "https://upstream.example/v1/responses",
        method: "POST",
      },
    });
  });
});
