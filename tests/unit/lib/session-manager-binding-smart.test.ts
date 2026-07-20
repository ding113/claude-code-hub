import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for SessionManager.updateSessionBindingSmart forceUpdate semantics.
 *
 * Hedge race winners bypass the smart-decision path (priority / circuit
 * health), while versioned bindings still use generation CAS so a stale winner
 * cannot overwrite a newer concurrent binding.
 */

let redisClientRef: {
  status: string;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  setex: ReturnType<typeof vi.fn>;
  pipeline: ReturnType<typeof vi.fn>;
} | null;

let lastPipeline: {
  setex: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
};

const bindingMocks = vi.hoisted(() => ({
  clearSessionBinding: vi.fn(),
  compareAndSetSessionBinding: vi.fn(),
  isSessionProviderCoolingDown: vi.fn(),
  mutateLegacySessionBindingSafely: vi.fn(),
  readOrReconcileSessionBinding: vi.fn(),
  refreshSessionBinding: vi.fn(),
}));

const makePipeline = () => {
  const pipeline = {
    setex: vi.fn(() => pipeline),
    exec: vi.fn(async () => []),
  };
  lastPipeline = pipeline;
  return pipeline;
};

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

vi.mock("@/lib/redis/session-binding", () => ({
  ...bindingMocks,
  getVersionedBindingCapabilityState: () => "unavailable",
}));

// Both are loaded via `await import(...)` inside updateSessionBindingSmart; the
// static vi.mock still intercepts the dynamic import.
vi.mock("@/repository/provider", () => ({
  findProviderById: vi.fn(),
}));

vi.mock("@/lib/circuit-breaker", () => ({
  isCircuitOpen: vi.fn(),
}));

import { isCircuitOpen } from "@/lib/circuit-breaker";
import { SessionManager } from "@/lib/session-manager";
import { findProviderById } from "@/repository/provider";

const SID = "sess-binding";
const KEY_ID = 42;
let legacyProviderId: number | null;

beforeEach(() => {
  vi.clearAllMocks();
  bindingMocks.readOrReconcileSessionBinding.mockResolvedValue({
    status: "unavailable",
    reason: "capability_unavailable",
    capabilityState: "unavailable",
    legacyFallbackAllowed: true,
  });
  legacyProviderId = null;
  bindingMocks.mutateLegacySessionBindingSafely.mockImplementation(async (input: any) => {
    if (input.mutation.type === "inspect") {
      return { status: "ok", changed: false, providerId: legacyProviderId };
    }
    if (input.mutation.type === "bind_if_absent") {
      if (legacyProviderId !== null) {
        return { status: "ok", changed: false, providerId: legacyProviderId };
      }
      legacyProviderId = input.mutation.providerId;
      return { status: "ok", changed: true, providerId: legacyProviderId };
    }
    if (input.mutation.type === "set") {
      legacyProviderId = input.mutation.providerId;
      return { status: "ok", changed: true, providerId: legacyProviderId };
    }
    throw new Error(`Unexpected mutation ${input.mutation.type}`);
  });
  redisClientRef = {
    status: "ready",
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
    setex: vi.fn(async () => "OK"),
    pipeline: vi.fn(() => makePipeline()),
  };
});

describe("SessionManager.updateSessionBindingSmart forceUpdate", () => {
  it("forceUpdate=true overrides a healthy higher-priority existing binding", async () => {
    // Existing binding -> provider 1 (healthy, higher priority than the winner)
    legacyProviderId = 1;
    vi.mocked(findProviderById).mockResolvedValue({ id: 1, name: "main", priority: 5 } as never);
    vi.mocked(isCircuitOpen).mockResolvedValue(false);

    const result = await SessionManager.updateSessionBindingSmart(
      SID,
      2, // winner id
      10, // winner priority (lower priority than current's 5)
      false, // isFirstAttempt
      false, // isFailoverSuccess
      KEY_ID,
      true // forceUpdate
    );

    expect(result).toMatchObject({ updated: true, reason: "race_winner_forced" });
    expect(bindingMocks.mutateLegacySessionBindingSafely).toHaveBeenCalledWith(
      expect.objectContaining({ mutation: { type: "set", providerId: 2 } })
    );
  });

  it("forceUpdate=true rebinds even when the winner equals the current binding", async () => {
    // Production winner==initialProvider race: the bound provider is already the winner,
    // but the race result must still (re)write the binding and refresh its TTL.
    legacyProviderId = 2;

    const result = await SessionManager.updateSessionBindingSmart(
      SID,
      2, // winner id == currently bound id
      10,
      false,
      false,
      KEY_ID,
      true // forceUpdate
    );

    expect(result).toMatchObject({ updated: true, reason: "race_winner_forced" });
    expect(bindingMocks.mutateLegacySessionBindingSafely).toHaveBeenCalledWith(
      expect.objectContaining({ mutation: { type: "set", providerId: 2 } })
    );
  });

  it("forceUpdate=false keeps the healthy higher-priority binding (documents the gap)", async () => {
    legacyProviderId = 1;
    vi.mocked(findProviderById).mockResolvedValue({ id: 1, name: "main", priority: 5 } as never);
    vi.mocked(isCircuitOpen).mockResolvedValue(false);

    const result = await SessionManager.updateSessionBindingSmart(
      SID,
      2,
      10,
      false,
      false,
      KEY_ID,
      false // forceUpdate
    );

    expect(result).toMatchObject({ updated: false, reason: "keep_healthy_higher_priority" });
  });

  it("forceUpdate=true short-circuits before consulting provider/circuit state", async () => {
    legacyProviderId = 1;

    await SessionManager.updateSessionBindingSmart(SID, 2, 10, false, false, KEY_ID, true);

    expect(findProviderById).not.toHaveBeenCalled();
    expect(isCircuitOpen).not.toHaveBeenCalled();
    // forceUpdate goes straight to the persistence path.
    expect(findProviderById).not.toHaveBeenCalled();
  });

  it("forceUpdate=true also persists the keyId binding with TTL", async () => {
    const result = await SessionManager.updateSessionBindingSmart(
      SID,
      2,
      10,
      false,
      false,
      KEY_ID,
      true
    );

    expect(result.updated).toBe(true);
    expect(bindingMocks.mutateLegacySessionBindingSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SID,
        keyId: KEY_ID,
        mutation: { type: "set", providerId: 2 },
      })
    );
  });

  it("isFailoverSuccess=true keeps reason failover_success even when forceUpdate=true", async () => {
    const result = await SessionManager.updateSessionBindingSmart(
      SID,
      2,
      10,
      false,
      true, // isFailoverSuccess
      KEY_ID,
      true // forceUpdate
    );

    expect(result).toMatchObject({ updated: true, reason: "failover_success" });
  });

  it("returns redis_not_ready regardless of forceUpdate when redis is unavailable", async () => {
    redisClientRef!.status = "connecting";

    const result = await SessionManager.updateSessionBindingSmart(
      SID,
      2,
      10,
      false,
      false,
      null,
      true
    );

    expect(result).toMatchObject({ updated: false, reason: "redis_not_ready" });
  });

  it("uses generation CAS instead of legacy writes when versioned binding is available", async () => {
    bindingMocks.readOrReconcileSessionBinding.mockResolvedValue({
      status: "ok",
      source: "existing",
      snapshot: {
        sessionId: SID,
        keyId: 42,
        providerId: 1,
        generation: "generation-a",
      },
      legacyFallbackAllowed: false,
    });
    bindingMocks.compareAndSetSessionBinding.mockResolvedValue({
      status: "ok",
      source: "updated",
      snapshot: {
        sessionId: SID,
        keyId: 42,
        providerId: 2,
        generation: "generation-b",
      },
      legacyFallbackAllowed: false,
    });

    const result = await SessionManager.updateSessionBindingSmart(
      SID,
      2,
      10,
      false,
      false,
      42,
      true
    );

    expect(result).toMatchObject({ updated: true, reason: "race_winner_forced" });
    expect(bindingMocks.compareAndSetSessionBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SID,
        keyId: 42,
        expectedGeneration: "generation-a",
        providerId: 2,
      })
    );
    expect(redisClientRef!.pipeline).not.toHaveBeenCalled();
    expect(redisClientRef!.setex).not.toHaveBeenCalled();
  });

  it.each([
    { isFailoverSuccess: false, forceUpdate: true },
    { isFailoverSuccess: true, forceUpdate: false },
  ])(
    "does not let a stale versioned winner overwrite a newer binding (%o)",
    async ({ isFailoverSuccess, forceUpdate }) => {
      bindingMocks.readOrReconcileSessionBinding.mockResolvedValue({
        status: "ok",
        source: "existing",
        snapshot: {
          sessionId: SID,
          keyId: KEY_ID,
          providerId: 1,
          generation: "generation-before-concurrent-update",
        },
        legacyFallbackAllowed: false,
      });
      bindingMocks.compareAndSetSessionBinding.mockResolvedValue({
        status: "conflict",
        reason: "generation_mismatch",
        legacyFallbackAllowed: false,
      });

      const result = await SessionManager.updateSessionBindingSmart(
        SID,
        2,
        10,
        false,
        isFailoverSuccess,
        KEY_ID,
        forceUpdate
      );

      expect(result).toEqual({
        updated: false,
        reason: "concurrent_binding_changed",
        details: "Session binding changed before the update committed",
      });
      expect(bindingMocks.compareAndSetSessionBinding).toHaveBeenCalledTimes(1);
      expect(bindingMocks.mutateLegacySessionBindingSafely).not.toHaveBeenCalled();
    }
  );

  it("does not fall back to legacy writes for a foreign owner conflict", async () => {
    bindingMocks.readOrReconcileSessionBinding.mockResolvedValue({
      status: "conflict",
      reason: "foreign_legacy_owner",
      legacyFallbackAllowed: false,
    });

    const result = await SessionManager.updateSessionBindingSmart(
      SID,
      2,
      10,
      false,
      false,
      42,
      true
    );

    expect(result).toEqual({
      updated: false,
      reason: "versioned_binding_conflict",
      details: "foreign_legacy_owner",
    });
    expect(redisClientRef!.pipeline).not.toHaveBeenCalled();
    expect(redisClientRef!.set).not.toHaveBeenCalled();
  });
});
