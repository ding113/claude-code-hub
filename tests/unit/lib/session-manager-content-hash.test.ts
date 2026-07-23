import { beforeEach, describe, expect, it, vi } from "vitest";

let redisClientRef: {
  status: string;
  get: ReturnType<typeof vi.fn>;
  setex: ReturnType<typeof vi.fn>;
  pipeline: ReturnType<typeof vi.fn>;
};
let values: Map<string, string>;

const bindingMocks = vi.hoisted(() => ({
  mutateLegacySessionBindingSafely: vi.fn(),
  readOrReconcileSessionBinding: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisClientRef,
}));

vi.mock("@/lib/redis/session-binding", () => ({
  ...bindingMocks,
  getVersionedBindingCapabilityState: () => "available",
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    getConcurrentCount: vi.fn(async () => 0),
  },
}));

import { SessionManager } from "@/lib/session-manager";

const MESSAGES = [{ role: "user", content: "identical tenant-sensitive prompt" }];

function contentHash(): string {
  const hash = SessionManager.calculateMessagesHash(MESSAGES);
  if (!hash) throw new Error("Expected test messages to produce a content hash");
  return hash;
}

function tenantHashKey(keyId: number): string {
  return `hash:${keyId}:${contentHash()}:session`;
}

function legacyHashKey(): string {
  return `hash:${contentHash()}:session`;
}

beforeEach(() => {
  vi.clearAllMocks();
  values = new Map<string, string>();

  const createPipeline = () => {
    const operations: Array<() => void> = [];
    const pipeline = {
      setex: vi.fn((key: string, _ttlSeconds: number, value: string) => {
        operations.push(() => values.set(key, value));
        return pipeline;
      }),
      exec: vi.fn(async () => {
        for (const operation of operations) operation();
        return operations.map(() => [null, "OK"]);
      }),
    };
    return pipeline;
  };

  redisClientRef = {
    status: "ready",
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    setex: vi.fn(async (key: string, _ttlSeconds: number, value: string) => {
      values.set(key, value);
      return "OK";
    }),
    pipeline: vi.fn(createPipeline),
  };

  bindingMocks.readOrReconcileSessionBinding.mockImplementation(
    async ({ sessionId, keyId }: { sessionId: string; keyId: number }) => {
      values.set(`session:${sessionId}:key`, keyId.toString());
      return {
        status: "ok",
        source: "created",
        snapshot: {
          sessionId,
          keyId,
          providerId: null,
          generation: `generation-${keyId}`,
        },
        legacyFallbackAllowed: false,
      };
    }
  );
});

describe("SessionManager content-hash mapping tenant isolation", () => {
  it("does not share a generated Session between API keys with identical content", async () => {
    const first = await SessionManager.getOrCreateSessionId(101, MESSAGES, null);
    await vi.waitFor(() => expect(values.get(tenantHashKey(101))).toBe(first));

    const second = await SessionManager.getOrCreateSessionId(202, MESSAGES, null);
    await vi.waitFor(() => expect(values.get(tenantHashKey(202))).toBe(second));

    expect(second).not.toBe(first);
    expect(values.has(legacyHashKey())).toBe(false);
  });

  it("continues to reuse the tenant-scoped mapping for the same API key", async () => {
    const first = await SessionManager.getOrCreateSessionId(101, MESSAGES, null);
    await vi.waitFor(() => expect(values.get(tenantHashKey(101))).toBe(first));

    bindingMocks.readOrReconcileSessionBinding.mockClear();
    const second = await SessionManager.getOrCreateSessionId(101, MESSAGES, null);

    expect(second).toBe(first);
    expect(bindingMocks.readOrReconcileSessionBinding).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: first, keyId: 101 })
    );
  });

  it.each([
    ["matching", "101"],
    ["foreign", "202"],
    ["missing", null],
  ])("never reads or imports an unscoped legacy mapping with a %s owner", async (_case, owner) => {
    const legacySessionId = `legacy-${_case}-owner-session`;
    values.set(legacyHashKey(), legacySessionId);
    if (owner !== null) values.set(`session:${legacySessionId}:key`, owner);

    const result = await SessionManager.getOrCreateSessionId(101, MESSAGES, null);

    expect(result).not.toBe(legacySessionId);
    await vi.waitFor(() => expect(values.get(tenantHashKey(101))).toBe(result));
    expect(redisClientRef.get).not.toHaveBeenCalledWith(legacyHashKey());
    expect(values.get(legacyHashKey())).toBe(legacySessionId);
    expect(values.get(`session:${legacySessionId}:key`)).toBe(owner ?? undefined);
  });

  it.each([
    ["missing", null],
    ["foreign", "202"],
    ["corrupt", "not-a-key-id"],
  ])("rejects a tenant-scoped mapping with a %s owner", async (_case, owner) => {
    const staleSessionId = `scoped-${_case}-owner-session`;
    values.set(tenantHashKey(101), staleSessionId);
    if (owner !== null) values.set(`session:${staleSessionId}:key`, owner);

    const result = await SessionManager.getOrCreateSessionId(101, MESSAGES, null);

    expect(result).not.toBe(staleSessionId);
    await vi.waitFor(() => expect(values.get(tenantHashKey(101))).toBe(result));
    expect(values.get(`session:${staleSessionId}:key`)).toBe(owner ?? undefined);
  });

  it("rejects a tenant-scoped mapping when canonical reconciliation fails", async () => {
    const staleSessionId = "scoped-conflicting-binding-session";
    values.set(tenantHashKey(101), staleSessionId);
    values.set(`session:${staleSessionId}:key`, "101");
    bindingMocks.readOrReconcileSessionBinding.mockResolvedValueOnce({
      status: "conflict",
      reason: "mirror_mismatch",
      legacyFallbackAllowed: false,
    });

    const result = await SessionManager.getOrCreateSessionId(101, MESSAGES, null);

    expect(result).not.toBe(staleSessionId);
    await vi.waitFor(() => expect(values.get(tenantHashKey(101))).toBe(result));
  });

  it("does not publish a tenant-scoped mapping when binding initialization fails", async () => {
    bindingMocks.readOrReconcileSessionBinding.mockResolvedValueOnce({
      status: "conflict",
      reason: "foreign_owner",
      legacyFallbackAllowed: false,
    });

    await SessionManager.getOrCreateSessionId(101, MESSAGES, null);

    await vi.waitFor(() => {
      expect(bindingMocks.readOrReconcileSessionBinding).toHaveBeenCalledTimes(1);
    });
    expect(values.has(tenantHashKey(101))).toBe(false);
    expect(redisClientRef.pipeline).not.toHaveBeenCalled();
  });
});
