import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import {
  acquireSessionDiscoveryLease,
  buildCanonicalSessionBindingKey,
  buildLegacySessionOwnerKey,
  buildLegacySessionProviderKey,
  buildSessionBindingKeys,
  buildSessionDiscoveryLeaseKey,
  buildSessionProviderCooldownKey,
  clearSessionBinding,
  compareAndSetSessionBinding,
  ensureVersionedBindingCapability,
  getVersionedBindingCapabilityState,
  isSessionProviderCoolingDown,
  mutateLegacySessionBindingSafely,
  readOrReconcileSessionBinding,
  refreshSessionBinding,
  releaseSessionDiscoveryLease,
  renewSessionDiscoveryLease,
  resetVersionedBindingCapabilityForTests,
  terminateSessionBinding,
  type SessionBindingRedisClient,
} from "@/lib/redis/session-binding";
import {
  CAS_SESSION_BINDING,
  CLEAR_SESSION_BINDING,
  DELETE_LEGACY_PROVIDER_IF_VALUE,
  READ_OR_RECONCILE_SESSION_BINDING,
  RELEASE_SESSION_DISCOVERY_LEASE,
  RENEW_SESSION_DISCOVERY_LEASE,
  RESTORE_LEGACY_PROVIDER_IF_ABSENT,
  TERMINATE_SESSION_BINDING,
} from "@/lib/redis/lua-scripts";

type EvalResponse = unknown | Error | ((args: unknown[]) => unknown | Promise<unknown>);

interface MockRedisOptions {
  cleanupFails?: boolean;
  evalSha?: boolean;
  evalShaNoScriptOnce?: boolean;
  operationResponses?: Partial<Record<string, EvalResponse[]>>;
  probeFails?: boolean;
  probeGate?: Promise<void>;
  status?: string;
  cooldownValue?: string | null;
  leaseSetResult?: unknown;
}

function createMockRedis(options: MockRedisOptions = {}) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const probeCooldowns = new Map<string, string>();
  let probeFails = options.probeFails ?? false;
  let cleanupFails = options.cleanupFails ?? false;
  let status = options.status ?? "ready";

  const evalMock = vi.fn(async (...args: unknown[]) => {
    const [script, numberOfKeys] = args as [string, number];
    const firstKey = String(args[2]);
    const isProbe = firstKey.startsWith("session-binding-capability-probe:");

    if (isProbe) {
      await options.probeGate;
      if (probeFails) throw new Error("CROSSSLOT keys in request do not hash to the same slot");
      if (script === READ_OR_RECONCILE_SESSION_BINDING) {
        return ["ok", "created", String(args[6]), ""];
      }
      if (script === CAS_SESSION_BINDING) {
        return ["ok", "updated", String(args[7]), String(args[8])];
      }
      if (script === CLEAR_SESSION_BINDING) {
        probeCooldowns.set(String(args[5]), String(args[8]));
        return ["ok", "cleared", String(args[8]), ""];
      }
      if (script === RENEW_SESSION_DISCOVERY_LEASE) return 1;
      if (script === RELEASE_SESSION_DISCOVERY_LEASE) return 1;
      throw new Error("Unexpected probe script");
    }

    const queue = options.operationResponses?.[script];
    const response = queue?.shift();
    if (response instanceof Error) throw response;
    if (typeof response === "function") return response(args);
    if (response !== undefined) return response;
    if (script === DELETE_LEGACY_PROVIDER_IF_VALUE) {
      const providerKey = String(args[2]);
      const expectedProvider = String(args[3]);
      if ((await getMock(providerKey)) !== expectedProvider) return 0;
      await delMock(providerKey);
      return 1;
    }
    throw new Error(`Missing operation response for ${numberOfKeys} key script`);
  });

  const getMock = vi.fn(async (key: string) => {
    if (probeCooldowns.has(key)) return probeCooldowns.get(key) ?? null;
    return options.cooldownValue ?? null;
  });
  const hgetMock = vi.fn(async (_key: string, _field: string) => null as string | null);
  const delMock = vi.fn(async (..._keys: string[]) => {
    if (cleanupFails) throw new Error("cleanup failed");
    return 4;
  });
  const existsMock = vi.fn(async () => 0);
  const expireMock = vi.fn(async () => 1);
  const setMock = vi.fn(async (key: string) => {
    if (key.startsWith("session-binding-capability-probe:")) return "OK";
    return options.leaseSetResult === undefined ? "OK" : options.leaseSetResult;
  });
  const setexMock = vi.fn(async () => "OK");
  const evalShaMock = vi.fn(async (..._args: unknown[]) => {
    if (options.evalShaNoScriptOnce) {
      options.evalShaNoScriptOnce = false;
      throw new Error("NOSCRIPT No matching script");
    }
    return ["ok", "existing", "generation-sha", "8"];
  });
  const onMock = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
    const callbacks = listeners.get(event) ?? new Set();
    callbacks.add(listener);
    listeners.set(event, callbacks);
    return redis;
  });
  const offMock = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
    listeners.get(event)?.delete(listener);
    return redis;
  });

  const redis = {
    get status() {
      return status;
    },
    eval: evalMock,
    ...(options.evalSha ? { evalsha: evalShaMock } : {}),
    get: getMock,
    hget: hgetMock,
    del: delMock,
    exists: existsMock,
    expire: expireMock,
    on: onMock,
    off: offMock,
    set: setMock,
    setex: setexMock,
  } satisfies SessionBindingRedisClient;

  return {
    redis,
    evalMock,
    evalShaMock,
    getMock,
    hgetMock,
    delMock,
    existsMock,
    expireMock,
    setMock,
    setexMock,
    onMock,
    offMock,
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
    setStatus(nextStatus: string) {
      status = nextStatus;
    },
    setProbeFails(value: boolean) {
      probeFails = value;
    },
    setCleanupFails(value: boolean) {
      cleanupFails = value;
    },
  };
}

describe("session binding key builders", () => {
  it("scopes canonical and cooldown keys by API key while preserving legacy mirrors", () => {
    const canonical = buildCanonicalSessionBindingKey("session:{a}", 17);
    const cooldown = buildSessionProviderCooldownKey("session:{a}", 17, 4);
    const lease = buildSessionDiscoveryLeaseKey("session:{a}", 17);

    expect(canonical).toMatch(/^session-binding:v1:\{[a-f0-9]{64}\}:binding$/);
    expect(cooldown).toMatch(/^session-binding:v1:\{[a-f0-9]{64}\}:provider:4:cooldown$/);
    expect(lease).toMatch(/^session-binding:v1:\{[a-f0-9]{64}\}:discovery-lease$/);
    expect(canonical.match(/\{([^}]+)\}/)?.[1]).toBe(cooldown.match(/\{([^}]+)\}/)?.[1]);
    expect(canonical.match(/\{([^}]+)\}/)?.[1]).toBe(lease.match(/\{([^}]+)\}/)?.[1]);
    expect(buildCanonicalSessionBindingKey("session:a", 18)).not.toBe(
      buildCanonicalSessionBindingKey("session:a", 17)
    );
    expect(buildSessionDiscoveryLeaseKey("session:a", 18)).not.toBe(
      buildSessionDiscoveryLeaseKey("session:a", 17)
    );
    expect(buildLegacySessionProviderKey("session:{a}")).toBe("session:session:{a}:provider");
    expect(buildLegacySessionOwnerKey("session:{a}")).toBe("session:session:{a}:key");
  });

  it("supports an isolated namespace without changing the production key shape", () => {
    const keys = buildSessionBindingKeys("sid", 9, "probe");
    expect(keys.canonical).toMatch(/^probe:session-binding:v1:\{[a-f0-9]{64}\}:binding$/);
    expect(keys.legacyProvider).toBe("probe:session:sid:provider");
    expect(keys.legacyOwner).toBe("probe:session:sid:key");
  });
});

describe("versioned binding capability", () => {
  beforeEach(() => {
    resetVersionedBindingCapabilityForTests();
  });

  it("probes reconcile, CAS, clear, cooldown, and cleanup exactly once per connection", async () => {
    const mock = createMockRedis();

    await expect(ensureVersionedBindingCapability(mock.redis)).resolves.toBe("available");
    await expect(ensureVersionedBindingCapability(mock.redis)).resolves.toBe("available");

    expect(getVersionedBindingCapabilityState()).toBe("available");
    expect(mock.evalMock).toHaveBeenCalledTimes(5);
    expect(mock.getMock).toHaveBeenCalledTimes(1);
    expect(mock.setMock).toHaveBeenCalledTimes(1);
    expect(mock.delMock).toHaveBeenCalledTimes(5);
    expect(mock.delMock.mock.calls.every((call) => call.length === 1)).toBe(true);
    expect(mock.onMock.mock.calls.map(([event]) => event)).toEqual([
      "close",
      "connect",
      "end",
      "ready",
      "reconnecting",
    ]);
  });

  it("shares one in-flight capability probe across concurrent callers", async () => {
    let releaseProbe: (() => void) | undefined;
    const probeGate = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const mock = createMockRedis({ probeGate });

    const first = ensureVersionedBindingCapability(mock.redis);
    const second = ensureVersionedBindingCapability(mock.redis);
    await vi.waitFor(() => expect(mock.evalMock).toHaveBeenCalledTimes(1));
    releaseProbe?.();

    await expect(Promise.all([first, second])).resolves.toEqual(["available", "available"]);
    expect(mock.evalMock).toHaveBeenCalledTimes(5);
  });

  it("stays unavailable on the same connection after a capability failure", async () => {
    const mock = createMockRedis({ probeFails: true });

    await expect(ensureVersionedBindingCapability(mock.redis)).resolves.toBe("unavailable");
    mock.setProbeFails(false);
    await expect(ensureVersionedBindingCapability(mock.redis)).resolves.toBe("unavailable");

    expect(mock.evalMock).toHaveBeenCalledTimes(1);
    expect(getVersionedBindingCapabilityState()).toBe("unavailable");
  });

  it("resets to unknown on reconnect and probes the new connection epoch", async () => {
    const mock = createMockRedis({ probeFails: true });
    await ensureVersionedBindingCapability(mock.redis);
    mock.setProbeFails(false);

    mock.emit("reconnecting");
    expect(getVersionedBindingCapabilityState()).toBe("unknown");
    await expect(ensureVersionedBindingCapability(mock.redis)).resolves.toBe("available");

    expect(mock.evalMock).toHaveBeenCalledTimes(6);
  });

  it("automatically probes when a reconnected client becomes ready", async () => {
    const mock = createMockRedis({ probeFails: true });
    await ensureVersionedBindingCapability(mock.redis);
    mock.setProbeFails(false);

    mock.emit("close");
    expect(getVersionedBindingCapabilityState()).toBe("unknown");
    mock.emit("ready");

    await vi.waitFor(() => expect(getVersionedBindingCapabilityState()).toBe("available"));
    expect(mock.evalMock).toHaveBeenCalledTimes(6);
  });

  it("does not become available when isolated probe cleanup fails", async () => {
    const mock = createMockRedis({ cleanupFails: true });

    await expect(ensureVersionedBindingCapability(mock.redis)).resolves.toBe("unavailable");
    expect(mock.evalMock).toHaveBeenCalledTimes(5);
    expect(mock.delMock).toHaveBeenCalledTimes(5);
  });

  it("detaches lifecycle listeners when tests reset state", async () => {
    const mock = createMockRedis();
    await ensureVersionedBindingCapability(mock.redis);

    resetVersionedBindingCapabilityForTests();

    expect(mock.offMock.mock.calls.map(([event]) => event)).toEqual([
      "close",
      "connect",
      "end",
      "ready",
      "reconnecting",
    ]);
    expect(getVersionedBindingCapabilityState()).toBe("unknown");
  });

  it("reports unknown without creating a probe when Redis is not configured", async () => {
    await expect(ensureVersionedBindingCapability()).resolves.toBe("unknown");
    expect(getVersionedBindingCapabilityState()).toBe("unknown");
  });
});

describe("session Discovery lease operations", () => {
  beforeEach(() => {
    resetVersionedBindingCapabilityForTests();
  });

  it("acquires a tenant-scoped lease with an explicit owner token and TTL", async () => {
    const mock = createMockRedis();

    const result = await acquireSessionDiscoveryLease({
      sessionId: "sid",
      keyId: 4,
      ttlSeconds: 61,
      ownerToken: "owner-a",
      redis: mock.redis,
    });

    expect(result).toEqual({
      status: "acquired",
      ownerToken: "owner-a",
      legacyFallbackAllowed: false,
    });
    expect(mock.setMock.mock.calls.at(-1)).toEqual([
      buildSessionDiscoveryLeaseKey("sid", 4),
      "owner-a",
      "EX",
      61,
      "NX",
    ]);
  });

  it("returns a lease conflict without revealing the current owner", async () => {
    const mock = createMockRedis({ leaseSetResult: null });

    const result = await acquireSessionDiscoveryLease({
      sessionId: "sid",
      keyId: 4,
      ttlSeconds: 30,
      redis: mock.redis,
    });

    expect(result).toEqual({
      status: "conflict",
      reason: "lease_held",
      legacyFallbackAllowed: false,
    });
  });

  it("renews and releases only through owner-token Lua primitives", async () => {
    const mock = createMockRedis({
      operationResponses: {
        [RENEW_SESSION_DISCOVERY_LEASE]: [1],
        [RELEASE_SESSION_DISCOVERY_LEASE]: [1],
      },
    });

    await expect(
      renewSessionDiscoveryLease({
        sessionId: "sid",
        keyId: 4,
        ownerToken: "owner-a",
        ttlSeconds: 45,
        redis: mock.redis,
      })
    ).resolves.toEqual({ status: "renewed", legacyFallbackAllowed: false });
    await expect(
      releaseSessionDiscoveryLease({
        sessionId: "sid",
        keyId: 4,
        ownerToken: "owner-a",
        redis: mock.redis,
      })
    ).resolves.toEqual({ status: "released", legacyFallbackAllowed: false });

    expect(mock.evalMock).toHaveBeenCalledWith(
      RENEW_SESSION_DISCOVERY_LEASE,
      1,
      buildSessionDiscoveryLeaseKey("sid", 4),
      "owner-a",
      "45"
    );
    expect(mock.evalMock).toHaveBeenCalledWith(
      RELEASE_SESSION_DISCOVERY_LEASE,
      1,
      buildSessionDiscoveryLeaseKey("sid", 4),
      "owner-a"
    );
  });

  it("reports a lost lease when renew or release no longer owns the key", async () => {
    const mock = createMockRedis({
      operationResponses: {
        [RENEW_SESSION_DISCOVERY_LEASE]: [0],
        [RELEASE_SESSION_DISCOVERY_LEASE]: [0],
      },
    });

    await expect(
      renewSessionDiscoveryLease({
        sessionId: "sid",
        keyId: 4,
        ownerToken: "stale-owner",
        ttlSeconds: 45,
        redis: mock.redis,
      })
    ).resolves.toEqual({
      status: "lost",
      reason: "not_owner_or_missing",
      legacyFallbackAllowed: false,
    });
    await expect(
      releaseSessionDiscoveryLease({
        sessionId: "sid",
        keyId: 4,
        ownerToken: "stale-owner",
        redis: mock.redis,
      })
    ).resolves.toEqual({
      status: "lost",
      reason: "not_owner_or_missing",
      legacyFallbackAllowed: false,
    });
  });

  it("rejects invalid identities before touching Redis", async () => {
    const mock = createMockRedis();

    await expect(
      acquireSessionDiscoveryLease({
        sessionId: "",
        keyId: 0,
        ttlSeconds: 0,
        ownerToken: "",
        redis: mock.redis,
      })
    ).resolves.toEqual({
      status: "conflict",
      reason: "invalid_input",
      legacyFallbackAllowed: false,
    });
    await expect(
      renewSessionDiscoveryLease({
        sessionId: "sid",
        keyId: 4,
        ttlSeconds: 30,
        ownerToken: "",
        redis: mock.redis,
      })
    ).resolves.toEqual({
      status: "lost",
      reason: "invalid_input",
      legacyFallbackAllowed: false,
    });

    expect(mock.evalMock).not.toHaveBeenCalled();
    expect(mock.setMock).not.toHaveBeenCalled();
  });
});

describe("versioned session binding operations", () => {
  beforeEach(() => {
    resetVersionedBindingCapabilityForTests();
  });

  it("reads a newly initialized null tombstone", async () => {
    const mock = createMockRedis({
      operationResponses: {
        [READ_OR_RECONCILE_SESSION_BINDING]: [(args) => ["ok", "created", String(args[6]), ""]],
      },
    });

    const result = await readOrReconcileSessionBinding({
      sessionId: "fresh",
      keyId: 7,
      ttlSeconds: 90,
      redis: mock.redis,
    });

    expect(result).toMatchObject({
      status: "ok",
      source: "created",
      snapshot: { sessionId: "fresh", keyId: 7, providerId: null },
      legacyFallbackAllowed: false,
    });
    const operation = mock.evalMock.mock.calls.at(-1);
    expect(operation?.slice(0, 5)).toEqual([
      READ_OR_RECONCILE_SESSION_BINDING,
      3,
      buildCanonicalSessionBindingKey("fresh", 7),
      "session:fresh:provider",
      "session:fresh:key",
    ]);
    expect(operation?.at(-1)).toBe("90");
  });

  it("parses an upgraded provider binding from Buffer values", async () => {
    const mock = createMockRedis({
      operationResponses: {
        [READ_OR_RECONCILE_SESSION_BINDING]: [
          [
            Buffer.from("ok"),
            Buffer.from("legacy_upgraded"),
            Buffer.from("generation-a"),
            Buffer.from("12"),
          ],
        ],
      },
    });

    const result = await refreshSessionBinding({
      sessionId: "legacy",
      keyId: 3,
      redis: mock.redis,
    });

    expect(result).toEqual({
      status: "ok",
      source: "legacy_upgraded",
      snapshot: {
        sessionId: "legacy",
        keyId: 3,
        providerId: 12,
        generation: "generation-a",
      },
      legacyFallbackAllowed: false,
    });
  });

  it("returns tenant conflicts without disabling capability", async () => {
    const mock = createMockRedis({
      operationResponses: {
        [READ_OR_RECONCILE_SESSION_BINDING]: [
          ["conflict", "foreign_legacy_owner"],
          ["ok", "existing", "generation-b", "6"],
        ],
      },
    });

    const first = await readOrReconcileSessionBinding({
      sessionId: "shared",
      keyId: 2,
      redis: mock.redis,
    });
    const second = await readOrReconcileSessionBinding({
      sessionId: "shared",
      keyId: 2,
      redis: mock.redis,
    });

    expect(first).toEqual({
      status: "conflict",
      reason: "foreign_legacy_owner",
      legacyFallbackAllowed: false,
    });
    expect(second.status).toBe("ok");
    expect(getVersionedBindingCapabilityState()).toBe("available");
  });

  it("fails closed on unknown conflict reasons without disabling capability", async () => {
    const mock = createMockRedis({
      operationResponses: {
        [READ_OR_RECONCILE_SESSION_BINDING]: [["conflict", "future_conflict_reason"]],
      },
    });

    const result = await readOrReconcileSessionBinding({
      sessionId: "shared",
      keyId: 2,
      redis: mock.redis,
    });

    expect(result).toEqual({
      status: "conflict",
      reason: "unknown_conflict",
      legacyFallbackAllowed: false,
    });
    expect(getVersionedBindingCapabilityState()).toBe("available");
  });

  it("fails closed on malformed successful results without disabling capability", async () => {
    const mock = createMockRedis({
      operationResponses: {
        [READ_OR_RECONCILE_SESSION_BINDING]: [["ok", "existing"]],
      },
    });

    const result = await readOrReconcileSessionBinding({
      sessionId: "sid",
      keyId: 2,
      redis: mock.redis,
    });

    expect(result).toEqual({
      status: "conflict",
      reason: "canonical_corrupt",
      legacyFallbackAllowed: false,
    });
    expect(getVersionedBindingCapabilityState()).toBe("available");
  });

  it("CAS updates the provider and rotates generation", async () => {
    const mock = createMockRedis({
      operationResponses: {
        [CAS_SESSION_BINDING]: [(args) => ["ok", "updated", String(args[7]), String(args[8])]],
      },
    });

    const result = await compareAndSetSessionBinding({
      sessionId: "sid",
      keyId: 4,
      expectedGeneration: "old-generation",
      providerId: 23,
      redis: mock.redis,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("Expected successful CAS");
    expect(result.snapshot.providerId).toBe(23);
    expect(result.snapshot.generation).not.toBe("old-generation");
    const operation = mock.evalMock.mock.calls.at(-1);
    expect(operation?.[6]).toBe("old-generation");
    expect(operation?.[8]).toBe("23");
  });

  it("returns generation conflicts without rotating global capability", async () => {
    const mock = createMockRedis({
      operationResponses: {
        [CAS_SESSION_BINDING]: [["conflict", "generation_mismatch"]],
      },
    });

    const result = await compareAndSetSessionBinding({
      sessionId: "sid",
      keyId: 4,
      expectedGeneration: "stale",
      providerId: 23,
      redis: mock.redis,
    });

    expect(result).toEqual({
      status: "conflict",
      reason: "generation_mismatch",
      legacyFallbackAllowed: false,
    });
    expect(getVersionedBindingCapabilityState()).toBe("available");
  });

  it("clears a provider with a tenant-scoped cooldown in the same Lua call", async () => {
    const mock = createMockRedis({
      cooldownValue: "cooldown-generation",
      operationResponses: {
        [CLEAR_SESSION_BINDING]: [(args) => ["ok", "cleared", String(args[8]), ""]],
      },
    });

    const result = await clearSessionBinding({
      sessionId: "sid",
      keyId: 4,
      expectedGeneration: "bound-generation",
      expectedProviderId: 23,
      cooldownTtlSeconds: 120,
      redis: mock.redis,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("Expected successful clear");
    expect(result.snapshot.providerId).toBeNull();
    expect(result.snapshot.generation).not.toBe("bound-generation");
    const operation = mock.evalMock.mock.calls.at(-1);
    expect(operation?.slice(2, 6)).toEqual([
      buildCanonicalSessionBindingKey("sid", 4),
      "session:sid:provider",
      "session:sid:key",
      buildSessionProviderCooldownKey("sid", 4, 23),
    ]);
    expect(operation?.slice(-3)).toEqual(["300", "23", "120"]);

    const cooldown = await isSessionProviderCoolingDown({
      sessionId: "sid",
      keyId: 4,
      providerId: 23,
      redis: mock.redis,
    });
    expect(cooldown).toEqual({
      status: "ok",
      coolingDown: true,
      legacyFallbackAllowed: false,
    });
  });

  it("rotates a null tombstone without creating a cooldown key", async () => {
    const mock = createMockRedis({
      operationResponses: {
        [CLEAR_SESSION_BINDING]: [(args) => ["ok", "cleared", String(args[8]), ""]],
      },
    });

    const result = await clearSessionBinding({
      sessionId: "sid",
      keyId: 4,
      expectedGeneration: "null-generation",
      expectedProviderId: null,
      redis: mock.redis,
    });

    expect(result.status).toBe("ok");
    const operation = mock.evalMock.mock.calls.at(-1);
    expect(operation?.[5]).toBe(buildCanonicalSessionBindingKey("sid", 4));
    expect(operation?.slice(-3)).toEqual(["300", "", "0"]);
  });

  it("rejects a cooldown without an expected provider before touching Redis", async () => {
    const mock = createMockRedis();

    const result = await clearSessionBinding({
      sessionId: "sid",
      keyId: 4,
      expectedGeneration: "generation",
      expectedProviderId: null,
      cooldownTtlSeconds: 30,
      redis: mock.redis,
    });

    expect(result).toEqual({
      status: "conflict",
      reason: "invalid_input",
      legacyFallbackAllowed: false,
    });
    expect(mock.evalMock).not.toHaveBeenCalled();
  });

  it("marks operation errors unavailable and allows only infrastructure fallback", async () => {
    const mock = createMockRedis({
      operationResponses: {
        [READ_OR_RECONCILE_SESSION_BINDING]: [new Error("ERR script execution disabled")],
      },
    });

    const first = await readOrReconcileSessionBinding({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
    });
    const callsAfterFailure = mock.evalMock.mock.calls.length;
    const second = await readOrReconcileSessionBinding({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
    });

    expect(first).toMatchObject({
      status: "unavailable",
      reason: "capability_unavailable",
      capabilityState: "unavailable",
      legacyFallbackAllowed: true,
    });
    expect(second).toMatchObject({
      status: "unavailable",
      reason: "capability_unavailable",
      legacyFallbackAllowed: true,
    });
    expect(mock.evalMock).toHaveBeenCalledTimes(callsAfterFailure);
  });

  it("allows legacy fallback on the first runtime capability error", async () => {
    const mock = createMockRedis({
      operationResponses: {
        [CAS_SESSION_BINDING]: [new Error("ERR script execution disabled")],
      },
    });

    const result = await compareAndSetSessionBinding({
      sessionId: "sid",
      keyId: 4,
      expectedGeneration: "generation-a",
      providerId: 8,
      redis: mock.redis,
    });

    expect(result).toMatchObject({
      status: "unavailable",
      reason: "capability_unavailable",
      capabilityState: "unavailable",
      legacyFallbackAllowed: true,
    });
    expect(getVersionedBindingCapabilityState()).toBe("unavailable");
  });

  it("fails closed on malformed binding data without disabling the capability", async () => {
    const mock = createMockRedis({
      operationResponses: {
        [READ_OR_RECONCILE_SESSION_BINDING]: [
          ["ok", "existing", "generation-a", "invalid-provider"],
          ["ok", "existing", "generation-b", "8"],
        ],
      },
    });

    const first = await readOrReconcileSessionBinding({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
    });
    const second = await readOrReconcileSessionBinding({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
    });

    expect(first).toEqual({
      status: "conflict",
      reason: "canonical_corrupt",
      legacyFallbackAllowed: false,
    });
    expect(second.status).toBe("ok");
    expect(getVersionedBindingCapabilityState()).toBe("available");
  });

  it("rejects a response from an obsolete connection epoch", async () => {
    let resolveOperation: ((value: unknown) => void) | undefined;
    const operation = new Promise<unknown>((resolve) => {
      resolveOperation = resolve;
    });
    const mock = createMockRedis({
      operationResponses: {
        [READ_OR_RECONCILE_SESSION_BINDING]: [() => operation],
      },
    });

    const pending = readOrReconcileSessionBinding({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
    });
    await vi.waitFor(() => expect(mock.evalMock).toHaveBeenCalledTimes(6));
    mock.emit("reconnecting");
    resolveOperation?.(["ok", "existing", "generation", "8"]);

    await expect(pending).resolves.toMatchObject({
      status: "unavailable",
      reason: "connection_changed",
      legacyFallbackAllowed: false,
    });
    expect(getVersionedBindingCapabilityState()).toBe("unknown");
  });

  it("does not run Lua while Redis is not ready", async () => {
    const mock = createMockRedis({ status: "connecting" });

    const result = await readOrReconcileSessionBinding({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
    });

    expect(result).toMatchObject({
      status: "unavailable",
      reason: "redis_not_ready",
      legacyFallbackAllowed: true,
    });
    expect(mock.evalMock).not.toHaveBeenCalled();
  });

  it("treats invalid identities as non-fallback conflicts", async () => {
    const mock = createMockRedis();

    const result = await readOrReconcileSessionBinding({
      sessionId: "",
      keyId: 0,
      ttlSeconds: -1,
      redis: mock.redis,
    });

    expect(result).toEqual({
      status: "conflict",
      reason: "invalid_input",
      legacyFallbackAllowed: false,
    });
    expect(mock.evalMock).not.toHaveBeenCalled();
  });

  it("returns false when a provider has no cooldown marker", async () => {
    const mock = createMockRedis({ cooldownValue: null });

    const result = await isSessionProviderCoolingDown({
      sessionId: "sid",
      keyId: 4,
      providerId: 9,
      redis: mock.redis,
    });

    expect(result).toEqual({
      status: "ok",
      coolingDown: false,
      legacyFallbackAllowed: false,
    });
  });

  it("rejects foreign legacy state before any fallback mutation", async () => {
    const mock = createMockRedis();
    mock.getMock.mockImplementation(async (key: string) => {
      if (key === "session:sid:key") return "foreign-key";
      if (key === "session:sid:provider") return "9";
      return null;
    });

    const result = await mutateLegacySessionBindingSafely({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
      mutation: { type: "set", providerId: 10 },
    });

    expect(result).toEqual({
      status: "conflict",
      reason: "foreign_legacy_owner",
      legacyFallbackAllowed: false,
    });
    expect(mock.setexMock).not.toHaveBeenCalled();
  });

  it("claims a truly empty legacy owner with NX and rechecks it", async () => {
    const mock = createMockRedis();
    let owner: string | null = null;
    mock.getMock.mockImplementation(async (key: string) => {
      if (key === "session:sid:key") return owner;
      return null;
    });
    mock.setMock.mockImplementation(async (_key: string, value: string) => {
      owner = value;
      return "OK";
    });

    const result = await mutateLegacySessionBindingSafely({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
      mutation: { type: "inspect" },
    });

    expect(result).toEqual({ status: "ok", changed: false, providerId: null });
    expect(mock.setMock).toHaveBeenCalledWith("session:sid:key", "4", "EX", 300, "NX");
  });

  it("blocks legacy mutation when canonical state already exists", async () => {
    const mock = createMockRedis();
    mock.existsMock.mockResolvedValue(1);

    const result = await mutateLegacySessionBindingSafely({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
      mutation: { type: "clear", expectedProviderId: 9 },
    });

    expect(result).toEqual({
      status: "conflict",
      reason: "canonical_exists",
      legacyFallbackAllowed: false,
    });
    expect(mock.getMock).not.toHaveBeenCalled();
  });

  it("fails closed and rolls back its provider write if canonical state appears mid-mutation", async () => {
    let provider: string | null = "8";
    const mock = createMockRedis({
      operationResponses: {
        [DELETE_LEGACY_PROVIDER_IF_VALUE]: [
          () => {
            provider = null;
            return 1;
          },
        ],
      },
    });
    let existsCalls = 0;
    mock.existsMock.mockImplementation(async () => {
      existsCalls += 1;
      // Initial guard and pre-mutation guard pass; the post-write guard sees
      // a versioned worker creating the canonical binding concurrently.
      return existsCalls === 3 ? 1 : 0;
    });
    mock.getMock.mockImplementation(async (key: string) => {
      if (key === "session:sid:key") return "4";
      if (key === "session:sid:provider") return provider;
      return null;
    });
    mock.setexMock.mockImplementation(async (key: string, _ttl: number, value: string) => {
      if (key === "session:sid:provider") provider = value;
      return "OK";
    });
    mock.delMock.mockImplementation(async (key: string) => {
      if (key === "session:sid:provider") provider = null;
      return 1;
    });

    const result = await mutateLegacySessionBindingSafely({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
      mutation: { type: "set", providerId: 10 },
    });

    expect(result).toEqual({
      status: "conflict",
      reason: "canonical_exists",
      legacyFallbackAllowed: false,
    });
    expect(provider).toBeNull();
    expect(mock.evalMock).toHaveBeenCalledWith(
      DELETE_LEGACY_PROVIDER_IF_VALUE,
      1,
      "session:sid:provider",
      "10"
    );
  });

  it("restores a cleared provider mirror if canonical state appears before the post-check", async () => {
    let provider: string | null = "8";
    const mock = createMockRedis({
      operationResponses: {
        [RESTORE_LEGACY_PROVIDER_IF_ABSENT]: [
          () => {
            provider = "8";
            return 1;
          },
        ],
      },
    });
    let existsCalls = 0;
    mock.existsMock.mockImplementation(async () => {
      existsCalls += 1;
      // Initial guard and pre-mutation guard pass; the post-clear guard sees
      // a versioned worker creating canonical state concurrently.
      return existsCalls === 3 ? 1 : 0;
    });
    mock.getMock.mockImplementation(async (key: string) => {
      if (key === "session:sid:key") return "4";
      if (key === "session:sid:provider") return provider;
      return null;
    });
    mock.hgetMock.mockResolvedValue("8");
    mock.delMock.mockImplementation(async (key: string) => {
      if (key === "session:sid:provider") provider = null;
      return 1;
    });

    const result = await mutateLegacySessionBindingSafely({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
      mutation: { type: "clear", expectedProviderId: 8 },
    });

    expect(result).toEqual({
      status: "conflict",
      reason: "canonical_exists",
      legacyFallbackAllowed: false,
    });
    expect(provider).toBe("8");
    expect(mock.evalMock).toHaveBeenCalledWith(
      RESTORE_LEGACY_PROVIDER_IF_ABSENT,
      1,
      "session:sid:provider",
      "8",
      "300"
    );
  });

  it("keeps a provider mirror when canonical imported the same value before rollback", async () => {
    let provider: string | null = null;
    const mock = createMockRedis({
      operationResponses: {
        [DELETE_LEGACY_PROVIDER_IF_VALUE]: [
          () => {
            provider = null;
            return 1;
          },
        ],
      },
    });
    let existsCalls = 0;
    mock.existsMock.mockImplementation(async () => {
      existsCalls += 1;
      return existsCalls === 3 ? 1 : 0;
    });
    mock.getMock.mockImplementation(async (key: string) => {
      if (key === "session:sid:key") return "4";
      if (key === "session:sid:provider") return provider;
      return null;
    });
    mock.setexMock.mockImplementation(async (key: string, _ttl: number, value: string) => {
      if (key === "session:sid:provider") provider = value;
      return "OK";
    });
    mock.hgetMock.mockResolvedValue("10");

    const result = await mutateLegacySessionBindingSafely({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
      mutation: { type: "set", providerId: 10 },
    });

    expect(result).toEqual({
      status: "conflict",
      reason: "canonical_exists",
      legacyFallbackAllowed: false,
    });
    expect(provider).toBe("10");
    expect(mock.evalMock).not.toHaveBeenCalledWith(
      DELETE_LEGACY_PROVIDER_IF_VALUE,
      1,
      "session:sid:provider",
      "10"
    );
  });

  it("rolls back a legacy provider bind when the owner cannot be refreshed", async () => {
    let owner: string | null = "4";
    let provider: string | null = null;
    const mock = createMockRedis({
      operationResponses: {
        [DELETE_LEGACY_PROVIDER_IF_VALUE]: [
          () => {
            provider = null;
            return 1;
          },
        ],
      },
    });
    let expireCalls = 0;
    mock.expireMock.mockImplementation(async () => {
      expireCalls += 1;
      if (expireCalls === 1) return 1;
      owner = null;
      return 0;
    });
    mock.getMock.mockImplementation(async (key: string) => {
      if (key === "session:sid:key") return owner;
      if (key === "session:sid:provider") return provider;
      return null;
    });
    mock.setMock.mockImplementation(async () => {
      owner = "5";
      return null;
    });
    mock.setexMock.mockImplementation(async (key: string, _ttl: number, value: string) => {
      if (key === "session:sid:provider") provider = value;
      return "OK";
    });

    const result = await mutateLegacySessionBindingSafely({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
      mutation: { type: "set", providerId: 10 },
    });

    expect(result).toEqual({
      status: "conflict",
      reason: "foreign_legacy_owner",
      legacyFallbackAllowed: false,
    });
    expect(provider).toBeNull();
    expect(mock.evalMock).toHaveBeenCalledWith(
      DELETE_LEGACY_PROVIDER_IF_VALUE,
      1,
      "session:sid:provider",
      "10"
    );
  });

  it("does not restore a mirror when the concurrent canonical binding is a null tombstone", async () => {
    let provider: string | null = "8";
    const mock = createMockRedis();
    let existsCalls = 0;
    mock.existsMock.mockImplementation(async () => {
      existsCalls += 1;
      return existsCalls === 3 ? 1 : 0;
    });
    mock.getMock.mockImplementation(async (key: string) => {
      if (key === "session:sid:key") return "4";
      if (key === "session:sid:provider") return provider;
      return null;
    });
    mock.hgetMock.mockResolvedValue(null);
    mock.delMock.mockImplementation(async (key: string) => {
      if (key === "session:sid:provider") provider = null;
      return 1;
    });

    const result = await mutateLegacySessionBindingSafely({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
      mutation: { type: "clear", expectedProviderId: 8 },
    });

    expect(result).toMatchObject({ status: "conflict", reason: "canonical_exists" });
    expect(provider).toBeNull();
    expect(mock.evalMock).not.toHaveBeenCalledWith(
      RESTORE_LEGACY_PROVIDER_IF_ABSENT,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it("does not clear a newer legacy Provider that replaced the expected value", async () => {
    let provider: string | null = "8";
    const mock = createMockRedis({
      operationResponses: {
        [DELETE_LEGACY_PROVIDER_IF_VALUE]: [
          () => {
            provider = "9";
            return 0;
          },
        ],
      },
    });
    mock.getMock.mockImplementation(async (key: string) => {
      if (key === "session:sid:key") return "4";
      if (key === "session:sid:provider") return provider;
      return null;
    });

    const result = await mutateLegacySessionBindingSafely({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
      mutation: { type: "clear", expectedProviderId: 8 },
    });

    expect(result).toMatchObject({ status: "conflict", reason: "provider_mismatch" });
    expect(provider).toBe("9");
    expect(mock.delMock).not.toHaveBeenCalledWith("session:sid:provider");
  });

  it("does not terminate a newer legacy Provider or its tenant owner", async () => {
    let owner: string | null = "4";
    let provider: string | null = "8";
    const mock = createMockRedis({
      operationResponses: {
        [DELETE_LEGACY_PROVIDER_IF_VALUE]: [
          () => {
            provider = "9";
            return 0;
          },
        ],
      },
    });
    mock.getMock.mockImplementation(async (key: string) => {
      if (key === "session:sid:key") return owner;
      if (key === "session:sid:provider") return provider;
      return null;
    });
    mock.delMock.mockImplementation(async (key: string) => {
      if (key === "session:sid:provider") provider = null;
      if (key === "session:sid:key") owner = null;
      return 1;
    });

    const result = await mutateLegacySessionBindingSafely({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
      mutation: { type: "terminate", expectedProviderIds: [8] },
    });

    expect(result).toMatchObject({ status: "conflict", reason: "provider_mismatch" });
    expect(provider).toBe("9");
    expect(owner).toBe("4");
    expect(mock.delMock).not.toHaveBeenCalled();
  });

  it("uses the tenant-authorized termination primitive and leaves a tombstone", async () => {
    const mock = createMockRedis({
      operationResponses: {
        [TERMINATE_SESSION_BINDING]: [(args) => ["ok", "terminated", String(args[6]), ""]],
      },
    });

    const result = await terminateSessionBinding({
      sessionId: "sid",
      keyId: 4,
      expectedProviderId: 9,
      redis: mock.redis,
    });

    expect(result).toMatchObject({
      status: "ok",
      source: "terminated",
      snapshot: { sessionId: "sid", keyId: 4, providerId: null },
    });
    expect(mock.evalMock.mock.calls.at(-1)?.[8]).toBe("9");
  });

  it("uses EVALSHA after capability warmup and falls back on NOSCRIPT", async () => {
    const mock = createMockRedis({
      evalSha: true,
      evalShaNoScriptOnce: true,
      operationResponses: {
        [READ_OR_RECONCILE_SESSION_BINDING]: [
          ["ok", "existing", "generation-a", "8"],
          ["ok", "existing", "generation-b", "8"],
        ],
      },
    });

    const first = await readOrReconcileSessionBinding({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
    });
    const second = await readOrReconcileSessionBinding({
      sessionId: "sid",
      keyId: 4,
      redis: mock.redis,
    });

    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    expect(mock.evalShaMock).toHaveBeenCalled();
    expect(mock.evalMock).toHaveBeenCalled();
  });

  it("covers tenant-safe legacy refresh, bind, set, clear, and terminate mutations", async () => {
    const mock = createMockRedis();
    let owner: string | null = "4";
    let provider: string | null = null;
    mock.getMock.mockImplementation(async (key: string) => {
      if (key === "session:sid:key") return owner;
      if (key === "session:sid:provider") return provider;
      return null;
    });
    mock.setMock.mockImplementation(async (key: string, value: string) => {
      if (key === "session:sid:key") owner = value;
      if (key === "session:sid:provider") provider = value;
      return "OK";
    });
    mock.setexMock.mockImplementation(async (key: string, _ttl: number, value: string) => {
      if (key === "session:sid:provider") provider = value;
      if (key === "session:sid:key") owner = value;
      return "OK";
    });
    mock.delMock.mockImplementation(async (key: string) => {
      if (key === "session:sid:provider") provider = null;
      if (key === "session:sid:key") owner = null;
      return 1;
    });

    await expect(
      mutateLegacySessionBindingSafely({
        sessionId: "sid",
        keyId: 4,
        redis: mock.redis,
        mutation: { type: "refresh" },
      })
    ).resolves.toMatchObject({ status: "ok" });
    await expect(
      mutateLegacySessionBindingSafely({
        sessionId: "sid",
        keyId: 4,
        redis: mock.redis,
        mutation: { type: "bind_if_absent", providerId: 8 },
      })
    ).resolves.toMatchObject({ status: "ok", changed: true, providerId: 8 });
    await expect(
      mutateLegacySessionBindingSafely({
        sessionId: "sid",
        keyId: 4,
        redis: mock.redis,
        mutation: { type: "set", providerId: 9 },
      })
    ).resolves.toMatchObject({ status: "ok", changed: true, providerId: 9 });
    await expect(
      mutateLegacySessionBindingSafely({
        sessionId: "sid",
        keyId: 4,
        redis: mock.redis,
        mutation: { type: "clear", expectedProviderId: 9 },
      })
    ).resolves.toMatchObject({ status: "ok", changed: true, providerId: null });

    provider = "10";
    await expect(
      mutateLegacySessionBindingSafely({
        sessionId: "sid",
        keyId: 4,
        redis: mock.redis,
        mutation: { type: "terminate", expectedProviderIds: [10] },
      })
    ).resolves.toMatchObject({
      status: "ok",
      changed: true,
      providerId: null,
      terminatedProviderId: 10,
    });
    expect(owner).toBe("4");
  });

  it("rejects malformed legacy mutation arguments before touching Redis", async () => {
    const mock = createMockRedis();

    await expect(
      mutateLegacySessionBindingSafely({
        sessionId: "sid",
        keyId: 4,
        redis: mock.redis,
        mutation: { type: "set", providerId: 0 },
      })
    ).resolves.toMatchObject({ status: "conflict", reason: "invalid_input" });
    await expect(
      mutateLegacySessionBindingSafely({
        sessionId: "sid",
        keyId: 4,
        redis: mock.redis,
        mutation: { type: "terminate", expectedProviderIds: [0] },
      })
    ).resolves.toMatchObject({ status: "conflict", reason: "invalid_input" });
    expect(mock.existsMock).not.toHaveBeenCalled();
  });
});
