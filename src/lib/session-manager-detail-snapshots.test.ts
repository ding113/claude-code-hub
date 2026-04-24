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
  pipeline: vi.fn(() => ({
    setex: vi.fn().mockReturnThis(),
    hset: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    del: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  })),
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
    mockStoreMessages = false;
    mockStoreSessionResponseBody = true;
  });

  it("stores and retrieves request/response before-after snapshots with TTL and redaction", async () => {
    await SessionManager.storeSessionRequestPhaseSnapshot(
      "sess_snap",
      "before",
      {
        body: {
          model: "gpt-5.2",
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
          model: "gpt-5.2",
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
        model: "gpt-5.2",
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
        model: "gpt-5.2",
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
        body: { model: "gpt-5.2" },
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
      body: { model: "gpt-5.2" },
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
