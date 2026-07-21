import { beforeEach, describe, expect, it, vi } from "vitest";

const bindingMocks = vi.hoisted(() => ({
  acquireSessionDiscoveryLease: vi.fn(),
  clearSessionBinding: vi.fn(),
  compareAndSetSessionBinding: vi.fn(),
  isSessionProviderCoolingDown: vi.fn(),
  readOrReconcileSessionBinding: vi.fn(),
  refreshSessionBinding: vi.fn(),
  releaseSessionDiscoveryLease: vi.fn(),
  renewSessionDiscoveryLease: vi.fn(),
  touchSessionBinding: vi.fn(),
}));

let redisClientRef: {
  status: string;
  del: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  pipeline: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  setex: ReturnType<typeof vi.fn>;
};

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

import { SessionManager } from "@/lib/session-manager";

const SESSION_ID = "session-versioned";
const KEY_ID = 7;
const PROVIDER_ID = 42;

function snapshot(providerId: number | null = PROVIDER_ID) {
  return {
    status: "ok" as const,
    source: "existing" as const,
    snapshot: {
      sessionId: SESSION_ID,
      keyId: KEY_ID,
      providerId,
      generation: "generation-a",
    },
    legacyFallbackAllowed: false as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const pipeline = {
    expire: vi.fn(),
    exec: vi.fn(async () => []),
    setex: vi.fn(),
  };
  pipeline.expire.mockReturnValue(pipeline);
  pipeline.setex.mockReturnValue(pipeline);
  redisClientRef = {
    status: "ready",
    del: vi.fn(async () => 1),
    eval: vi.fn(async () => 1),
    get: vi.fn(async () => null),
    pipeline: vi.fn(() => pipeline),
    set: vi.fn(async () => "OK"),
    setex: vi.fn(async () => "OK"),
  };
  bindingMocks.readOrReconcileSessionBinding.mockResolvedValue(snapshot());
  bindingMocks.acquireSessionDiscoveryLease.mockResolvedValue({
    status: "acquired",
    ownerToken: "owner-a",
    legacyFallbackAllowed: false,
  });
  bindingMocks.renewSessionDiscoveryLease.mockResolvedValue({
    status: "renewed",
    legacyFallbackAllowed: false,
  });
  bindingMocks.releaseSessionDiscoveryLease.mockResolvedValue({
    status: "released",
    legacyFallbackAllowed: false,
  });
  bindingMocks.touchSessionBinding.mockResolvedValue({
    ...snapshot(),
    source: "touched",
  });
});

describe("SessionManager versioned binding adapter", () => {
  it("delegates the complete tenant-scoped Discovery lease lifecycle", async () => {
    await expect(
      SessionManager.acquireSessionDiscoveryLease(SESSION_ID, KEY_ID, 61, "owner-a")
    ).resolves.toMatchObject({ status: "acquired", ownerToken: "owner-a" });
    await expect(
      SessionManager.renewSessionDiscoveryLease(SESSION_ID, KEY_ID, "owner-a", 61)
    ).resolves.toMatchObject({ status: "renewed" });
    await expect(
      SessionManager.releaseSessionDiscoveryLease(SESSION_ID, KEY_ID, "owner-a")
    ).resolves.toMatchObject({ status: "released" });

    expect(bindingMocks.acquireSessionDiscoveryLease).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        keyId: KEY_ID,
        ttlSeconds: 61,
        ownerToken: "owner-a",
        redis: redisClientRef,
      })
    );
    expect(bindingMocks.renewSessionDiscoveryLease).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        keyId: KEY_ID,
        ttlSeconds: 61,
        ownerToken: "owner-a",
        redis: redisClientRef,
      })
    );
    expect(bindingMocks.releaseSessionDiscoveryLease).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        keyId: KEY_ID,
        ownerToken: "owner-a",
        redis: redisClientRef,
      })
    );
  });

  it("returns the tenant-scoped provider without reading the legacy mirror", async () => {
    await expect(SessionManager.getSessionProvider(SESSION_ID, KEY_ID)).resolves.toBe(PROVIDER_ID);

    expect(bindingMocks.readOrReconcileSessionBinding).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID, keyId: KEY_ID })
    );
    expect(redisClientRef.get).not.toHaveBeenCalled();
  });

  it("touches only the captured binding and exposes a TTL-derived heartbeat interval", async () => {
    const binding = snapshot().snapshot;
    const configuredTtl = Number.parseInt(process.env.SESSION_TTL || "300", 10);

    await expect(SessionManager.touchVersionedSessionBinding(binding)).resolves.toMatchObject({
      status: "ok",
      source: "touched",
    });

    expect(bindingMocks.touchSessionBinding).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      keyId: KEY_ID,
      expectedGeneration: "generation-a",
      expectedProviderId: PROVIDER_ID,
      ttlSeconds: configuredTtl,
      redis: redisClientRef,
    });
    expect(SessionManager.getVersionedSessionBindingRefreshIntervalMs()).toBe(
      Math.max(1, Math.floor((configuredTtl * 1000) / 3))
    );
  });

  it("fails closed on a foreign legacy owner", async () => {
    bindingMocks.readOrReconcileSessionBinding.mockResolvedValue({
      status: "conflict",
      reason: "foreign_legacy_owner",
      legacyFallbackAllowed: false,
    });

    await expect(SessionManager.getSessionProvider(SESSION_ID, KEY_ID)).resolves.toBeNull();

    expect(redisClientRef.get).not.toHaveBeenCalled();
  });

  it("clears through generation CAS and does not delete the legacy provider directly", async () => {
    bindingMocks.clearSessionBinding.mockResolvedValue({
      status: "ok",
      source: "cleared",
      snapshot: {
        sessionId: SESSION_ID,
        keyId: KEY_ID,
        providerId: null,
        generation: "generation-b",
      },
      legacyFallbackAllowed: false,
    });

    await expect(
      SessionManager.clearSessionProvider(SESSION_ID, PROVIDER_ID, KEY_ID)
    ).resolves.toBe(true);

    expect(bindingMocks.clearSessionBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        keyId: KEY_ID,
        expectedGeneration: "generation-a",
        expectedProviderId: PROVIDER_ID,
      })
    );
    expect(redisClientRef.del).not.toHaveBeenCalled();
    expect(redisClientRef.eval).not.toHaveBeenCalled();
  });

  it("does not let a Codex cache key claim a foreign legacy session", async () => {
    bindingMocks.readOrReconcileSessionBinding.mockResolvedValue({
      status: "conflict",
      reason: "foreign_legacy_owner",
      legacyFallbackAllowed: false,
    });

    await expect(
      SessionManager.updateSessionWithCodexCacheKey(
        "current-session",
        "shared-cache-key",
        PROVIDER_ID,
        KEY_ID
      )
    ).resolves.toEqual({ sessionId: "current-session", updated: false });

    expect(redisClientRef.get).not.toHaveBeenCalled();
    expect(redisClientRef.pipeline).not.toHaveBeenCalled();
    expect(redisClientRef.setex).not.toHaveBeenCalled();
  });
});
