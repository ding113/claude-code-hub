import { Buffer } from "node:buffer";
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
vi.mock("@/app/v1/_lib/proxy/errors", () => ({
  sanitizeHeaders: vi.fn(() => ""),
  sanitizeUrl: vi.fn((url: unknown) => String(url)),
}));

const stringStore = new Map<string, string>();
const hashStore = new Map<string, Map<string, string>>();
const ttlStore = new Map<string, number>();

function responseBundle(key: string): Map<string, string> | undefined {
  return hashStore.get(key);
}

function bodyFields(key: string): string[] {
  return [...(responseBundle(key)?.entries() ?? [])]
    .filter(([field]) => field.startsWith("body:"))
    .map(([, value]) => value);
}

const redisMock = {
  status: "ready",
  setex: vi.fn((key: string, ttl: number, value: string) => {
    stringStore.set(key, value);
    ttlStore.set(key, ttl);
    return Promise.resolve("OK");
  }),
  get: vi.fn((key: string) => Promise.resolve(stringStore.get(key) ?? null)),
  del: vi.fn((...keys: string[]) => {
    let removed = 0;
    for (const key of keys) {
      removed += Number(stringStore.delete(key));
      removed += Number(hashStore.delete(key));
      ttlStore.delete(key);
    }
    return Promise.resolve(removed);
  }),
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
  eval: vi.fn(async (script: string, keyCount: number, ...rawArgs: Array<string | number>) => {
    const keys = rawArgs.slice(0, keyCount).map(String);
    const args = rawArgs.slice(keyCount);
    const key = keys[0];
    if (script.includes("cch:session-response-bundle:write:v1")) {
      const [
        ttl,
        totalBytes,
        overBudget,
        legacyPresent,
        beforePresent,
        afterPresent,
        legacyRef,
        beforeRef,
        afterRef,
        ...bodies
      ] = args.map(String);
      for (const currentKey of keys) {
        stringStore.delete(currentKey);
        hashStore.delete(currentKey);
        ttlStore.delete(currentKey);
      }
      const value = new Map<string, string>([
        ["schema", "1"],
        ["layout", "dedup"],
        ["total_bytes", totalBytes],
        ["over_budget", overBudget],
      ]);
      for (const [view, present, ref] of [
        ["legacy", legacyPresent, legacyRef],
        ["before", beforePresent, beforeRef],
        ["after", afterPresent, afterRef],
      ] as const) {
        if (present === "1") value.set(`present:${view}`, "1");
        if (ref) value.set(`ref:${view}`, ref);
      }
      bodies.forEach((body, index) => value.set(`body:${index}`, body));
      hashStore.set(key, value);
      ttlStore.set(key, Number(ttl));
      return 1;
    }

    if (script.includes("cch:session-response-bundle:write-legacy:v1")) {
      const [ttl, ...viewArgs] = args.map(String);
      for (const currentKey of keys) {
        stringStore.delete(currentKey);
        hashStore.delete(currentKey);
        ttlStore.delete(currentKey);
      }

      const value = new Map<string, string>([
        ["schema", "1"],
        ["layout", "legacy"],
      ]);
      for (let index = 0; index < 3; index += 1) {
        const view = ["legacy", "before", "after"][index];
        const offset = index * 3;
        if (viewArgs[offset] === "1") value.set(`present:${view}`, "1");
        if (viewArgs[offset + 1] === "1") {
          stringStore.set(keys[index + 1], viewArgs[offset + 2]);
          ttlStore.set(keys[index + 1], Number(ttl));
        }
      }
      hashStore.set(key, value);
      ttlStore.set(key, Number(ttl));
      return 1;
    }

    if (script.includes("cch:session-response-bundle:read:v1")) {
      const value = hashStore.get(key);
      if (!value) return [0, 0, null, 0];
      const present = value.get(`present:${String(args[0])}`) === "1";
      if (value.get("layout") === "legacy") return [1, present ? 1 : 0, null, 1];
      const ref = value.get(`ref:${String(args[0])}`);
      return [1, present ? 1 : 0, ref === undefined ? null : (value.get(`body:${ref}`) ?? null), 0];
    }

    throw new Error("unexpected Redis script");
  }),
};

vi.mock("@/lib/redis", () => ({ getRedisClient: () => redisMock }));

let mockStoreMessages = true;
let mockStoreSessionResponseBody = true;
let mockResponseBodyDedupEnabled = true;
let mockSessionResponseBodyMaxBytes = 1024;

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => ({
    STORE_SESSION_MESSAGES: mockStoreMessages,
    STORE_SESSION_RESPONSE_BODY: mockStoreSessionResponseBody,
    SESSION_RESPONSE_BODY_DEDUP_ENABLED: mockResponseBodyDedupEnabled,
    SESSION_RESPONSE_BODY_MAX_BYTES: mockSessionResponseBodyMaxBytes,
    SESSION_TTL: 300,
  }),
}));

const { SessionManager } = await import("@/lib/session-manager");

describe("SessionManager response body deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stringStore.clear();
    hashStore.clear();
    ttlStore.clear();
    redisMock.status = "ready";
    mockStoreMessages = true;
    mockStoreSessionResponseBody = true;
    mockResponseBodyDedupEnabled = true;
    mockSessionResponseBodyMaxBytes = 1024;
  });

  it.each([
    ["all views are identical", { legacy: "same", before: "same", after: "same" }, 1],
    ["legacy and before are identical", { legacy: "same", before: "same", after: "after" }, 2],
    ["legacy and after are identical", { legacy: "same", before: "before", after: "same" }, 2],
    ["before and after are identical", { legacy: "legacy", before: "same", after: "same" }, 2],
    ["all views are different", { legacy: "legacy", before: "before", after: "after" }, 3],
  ])("stores one physical bundle when %s", async (_name, bodies, expectedUniqueBodies) => {
    await SessionManager.storeSessionResponseBodySet("sess_views", bodies, 1);

    const key = "session:sess_views:req:1:response-bodies:v1";
    expect(hashStore.size).toBe(1);
    expect(bodyFields(key)).toHaveLength(expectedUniqueBodies);
    expect(stringStore.size).toBe(0);
    await expect(SessionManager.getSessionResponse("sess_views", 1)).resolves.toBe(bodies.legacy);
    await expect(
      SessionManager.getSessionResponsePhaseSnapshot("sess_views", "before", 1)
    ).resolves.toEqual({
      body: bodies.before,
      headers: null,
      meta: { upstreamUrl: null, statusCode: null },
    });
    await expect(
      SessionManager.getSessionResponsePhaseSnapshot("sess_views", "after", 1)
    ).resolves.toEqual({
      body: bodies.after,
      headers: null,
      meta: { upstreamUrl: null, statusCode: null },
    });
  });

  it("deduplicates bodies only after redaction", async () => {
    mockStoreMessages = false;
    const legacy = JSON.stringify({ id: "same", content: [{ type: "text", text: "secret-a" }] });
    const before = JSON.stringify({ id: "same", content: [{ type: "text", text: "secret-b" }] });
    const after = JSON.stringify({
      id: "different",
      content: [{ type: "text", text: "secret-c" }],
    });

    await SessionManager.storeSessionResponseBodySet("sess_redacted", { legacy, before, after }, 1);

    const bodies = bodyFields("session:sess_redacted:req:1:response-bodies:v1");
    expect(bodies).toHaveLength(2);
    expect(bodies.some((body) => body.includes("secret-"))).toBe(false);
    await expect(SessionManager.getSessionResponse("sess_redacted", 1)).resolves.toBe(
      JSON.stringify({ id: "same", content: [{ type: "text", text: "[REDACTED]" }] })
    );
  });

  it("keeps bodies distinct when their post-redaction values differ", async () => {
    mockStoreMessages = false;

    await SessionManager.storeSessionResponseBodySet(
      "sess_redacted_distinct",
      {
        legacy: JSON.stringify({ id: "one", content: [{ type: "text", text: "secret-a" }] }),
        before: JSON.stringify({ id: "two", content: [{ type: "text", text: "secret-b" }] }),
        after: JSON.stringify({ id: "three", content: [{ type: "text", text: "secret-c" }] }),
      },
      1
    );

    expect(bodyFields("session:sess_redacted_distinct:req:1:response-bodies:v1")).toHaveLength(3);
  });

  it("does not share response body values across request-scoped bundles", async () => {
    mockStoreMessages = false;
    const body = JSON.stringify({ id: "same", content: [{ type: "text", text: "secret" }] });

    await SessionManager.storeSessionResponseBodySet(
      "sess_scope_one",
      { legacy: body, before: body, after: body },
      1
    );
    await SessionManager.storeSessionResponseBodySet(
      "sess_scope_two",
      { legacy: body, before: body, after: body },
      1
    );

    expect([...hashStore.keys()].sort()).toEqual([
      "session:sess_scope_one:req:1:response-bodies:v1",
      "session:sess_scope_two:req:1:response-bodies:v1",
    ]);
    expect(bodyFields("session:sess_scope_one:req:1:response-bodies:v1")).toEqual([
      JSON.stringify({ id: "same", content: [{ type: "text", text: "[REDACTED]" }] }),
    ]);
    expect(bodyFields("session:sess_scope_two:req:1:response-bodies:v1")).toHaveLength(1);
  });

  it("applies the aggregate limit to distinct UTF-8 bytes", async () => {
    mockSessionResponseBodyMaxBytes = 4;

    await SessionManager.storeSessionResponseBodySet(
      "sess_utf8_exact",
      { legacy: "中a", before: "中a", after: "中a" },
      1
    );
    expect(bodyFields("session:sess_utf8_exact:req:1:response-bodies:v1")).toEqual(["中a"]);

    await SessionManager.storeSessionResponseBodySet(
      "sess_utf8_over",
      { legacy: "中ab", before: "中ab", after: "中ab" },
      1
    );
    const overBudget = responseBundle("session:sess_utf8_over:req:1:response-bodies:v1");
    expect(overBudget?.get("over_budget")).toBe("1");
    expect(bodyFields("session:sess_utf8_over:req:1:response-bodies:v1")).toEqual([]);
    await expect(SessionManager.getSessionResponse("sess_utf8_over", 1)).resolves.toBeNull();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "SessionManager: Skipped response body bundle over aggregate limit",
      { sessionId: "sess_utf8_over", requestSequence: 1, byteSize: 5, maxBytes: 4 }
    );
  });

  it("reads legacy keys when no response bundle exists", async () => {
    stringStore.set("session:sess_legacy:req:1:response", "legacy response");
    stringStore.set("session:sess_legacy:req:1:snapshot:response:before:body", "legacy before");
    stringStore.set("session:sess_legacy:req:1:snapshot:response:after:body", "legacy after");

    await expect(SessionManager.getSessionResponse("sess_legacy", 1)).resolves.toBe(
      "legacy response"
    );
    await expect(
      SessionManager.getSessionResponsePhaseSnapshot("sess_legacy", "before", 1)
    ).resolves.toMatchObject({ body: "legacy before" });
    await expect(
      SessionManager.getSessionResponsePhaseSnapshot("sess_legacy", "after", 1)
    ).resolves.toMatchObject({ body: "legacy after" });
  });

  it("treats an over-budget bundle as authoritative over stale legacy keys", async () => {
    mockSessionResponseBodyMaxBytes = 4;
    stringStore.set("session:sess_authoritative:req:1:response", "stale");
    stringStore.set("session:sess_authoritative:req:1:snapshot:response:after:body", "stale");

    await SessionManager.storeSessionResponseBodySet(
      "sess_authoritative",
      { legacy: "12345", before: "12345", after: "12345" },
      1
    );

    await expect(SessionManager.getSessionResponse("sess_authoritative", 1)).resolves.toBeNull();
    await expect(
      SessionManager.getSessionResponsePhaseSnapshot("sess_authoritative", "after", 1)
    ).resolves.toEqual({
      body: null,
      headers: null,
      meta: { upstreamUrl: null, statusCode: null },
    });
  });

  it("atomically replaces a prior generation without stale bodies and refreshes one TTL", async () => {
    await SessionManager.storeSessionResponseBodySet(
      "sess_retry",
      { legacy: "first", before: "first", after: "first" },
      1
    );
    await SessionManager.storeSessionResponseBodySet(
      "sess_retry",
      { legacy: "second", before: "before", after: "second" },
      1
    );

    const key = "session:sess_retry:req:1:response-bodies:v1";
    expect(bodyFields(key).sort()).toEqual(["before", "second"]);
    expect(bodyFields(key)).not.toContain("first");
    expect(ttlStore).toEqual(new Map([[key, 300]]));
    await expect(SessionManager.getSessionResponse("sess_retry", 1)).resolves.toBe("second");
    await expect(
      SessionManager.getSessionResponsePhaseSnapshot("sess_retry", "before", 1)
    ).resolves.toMatchObject({ body: "before" });
  });

  it("keeps legacy writes during the reader-first rollout phase", async () => {
    mockResponseBodyDedupEnabled = false;

    await SessionManager.storeSessionResponseBodySet(
      "sess_rollout",
      { legacy: "same", before: "same", after: "same" },
      1
    );

    expect(responseBundle("session:sess_rollout:req:1:response-bodies:v1")).toEqual(
      new Map([
        ["schema", "1"],
        ["layout", "legacy"],
        ["present:legacy", "1"],
        ["present:before", "1"],
        ["present:after", "1"],
      ])
    );
    expect(stringStore.get("session:sess_rollout:req:1:response")).toBe("same");
    expect(stringStore.get("session:sess_rollout:req:1:snapshot:response:before:body")).toBe(
      "same"
    );
    expect(stringStore.get("session:sess_rollout:req:1:snapshot:response:after:body")).toBe("same");
  });

  it("atomically switches between dedup and legacy writer generations", async () => {
    await SessionManager.storeSessionResponseBodySet(
      "sess_mixed_rollout",
      { legacy: "dedup-first", before: "dedup-first", after: "dedup-first" },
      1
    );

    mockResponseBodyDedupEnabled = false;
    await SessionManager.storeSessionResponseBodySet(
      "sess_mixed_rollout",
      { legacy: "legacy-second", before: "legacy-before", after: "legacy-second" },
      1
    );

    const key = "session:sess_mixed_rollout:req:1:response-bodies:v1";
    expect(responseBundle(key)?.get("layout")).toBe("legacy");
    expect(bodyFields(key)).toEqual([]);
    await expect(SessionManager.getSessionResponse("sess_mixed_rollout", 1)).resolves.toBe(
      "legacy-second"
    );
    await expect(
      SessionManager.getSessionResponsePhaseSnapshot("sess_mixed_rollout", "before", 1)
    ).resolves.toMatchObject({ body: "legacy-before" });

    mockResponseBodyDedupEnabled = true;
    await SessionManager.storeSessionResponseBodySet(
      "sess_mixed_rollout",
      { legacy: "dedup-third", before: "dedup-third", after: "dedup-third" },
      1
    );

    expect(responseBundle(key)?.get("layout")).toBe("dedup");
    expect(bodyFields(key)).toEqual(["dedup-third"]);
    expect(stringStore.size).toBe(0);
    await expect(SessionManager.getSessionResponse("sess_mixed_rollout", 1)).resolves.toBe(
      "dedup-third"
    );
  });

  it("does not create legacy or bundled bodies when response storage is disabled", async () => {
    mockStoreSessionResponseBody = false;

    await SessionManager.storeSessionResponseBodySet(
      "sess_disabled",
      { legacy: "same", before: "same", after: "same" },
      1
    );

    expect(hashStore.size).toBe(0);
    expect(stringStore.size).toBe(0);
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  it("counts only unique body bytes against the aggregate budget", async () => {
    mockSessionResponseBodyMaxBytes = 8;

    await SessionManager.storeSessionResponseBodySet(
      "sess_budget",
      { legacy: "1234", before: "1234", after: "5678" },
      1
    );

    const key = "session:sess_budget:req:1:response-bodies:v1";
    expect(bodyFields(key).reduce((sum, body) => sum + Buffer.byteLength(body), 0)).toBe(8);
    expect(responseBundle(key)?.get("total_bytes")).toBe("8");
    expect(responseBundle(key)?.get("over_budget")).toBe("0");
  });
});
