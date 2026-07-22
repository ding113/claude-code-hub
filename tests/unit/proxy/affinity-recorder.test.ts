import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FingerprintChain } from "@/app/v1/_lib/proxy/affinity/fingerprint";
import type { ProxySession, SessionAffinityState } from "@/app/v1/_lib/proxy/session";

const envControl = vi.hoisted(() => ({
  enabled: true,
  ttlSeconds: 3600,
}));

const storeMocks = vi.hoisted(() => ({
  put: vi.fn(async () => {}),
  tombstone: vi.fn(async () => {}),
  lookup: vi.fn(async () => null),
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => ({
    ENABLE_PREFIX_AFFINITY: envControl.enabled,
    PREFIX_AFFINITY_TTL_SECONDS: envControl.ttlSeconds,
  }),
}));

vi.mock("@/app/v1/_lib/proxy/affinity/affinity-store", () => ({
  getAffinityStore: () => storeMocks,
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  recordAffinityWinner,
  tombstoneAffinityOnFailure,
} from "@/app/v1/_lib/proxy/affinity/affinity-recorder";

function makeChain(tailDepth = 2): FingerprintChain {
  return {
    sys: { depth: 0, fp: "sysfp", prefixBytes: 10 },
    tail: Array.from({ length: tailDepth }, (_, i) => ({
      depth: i + 1,
      fp: `fp${i + 1}`,
      prefixBytes: 10 * (i + 2),
    })),
  };
}

function makeAffinity(overrides: Partial<SessionAffinityState> = {}): SessionAffinityState {
  return {
    scopeTag: "scope123",
    chain: makeChain(),
    nominatedProviderId: null,
    matchedFp: null,
    matchedTier: null,
    ...overrides,
  };
}

function makeSession(affinity: SessionAffinityState | null): ProxySession {
  return { affinity } as unknown as ProxySession;
}

beforeEach(() => {
  envControl.enabled = true;
  envControl.ttlSeconds = 3600;
});

describe("recordAffinityWinner", () => {
  it("writes tip + sys bindings for the winning provider with the configured TTL", async () => {
    await recordAffinityWinner(makeSession(makeAffinity()), 42);
    expect(storeMocks.put).toHaveBeenCalledTimes(1);
    expect(storeMocks.put).toHaveBeenCalledWith("scope123", "fp2", "sysfp", 42, 3600);
  });

  it("uses sys as tip when the chain has no conversation boundaries", async () => {
    await recordAffinityWinner(makeSession(makeAffinity({ chain: makeChain(0) })), 7);
    expect(storeMocks.put).toHaveBeenCalledWith("scope123", "sysfp", "sysfp", 7, 3600);
  });

  it("is a no-op when ENABLE_PREFIX_AFFINITY is off", async () => {
    envControl.enabled = false;
    await recordAffinityWinner(makeSession(makeAffinity()), 42);
    expect(storeMocks.put).not.toHaveBeenCalled();
  });

  it("is a no-op without affinity state or with a non-positive provider id", async () => {
    await recordAffinityWinner(makeSession(null), 42);
    await recordAffinityWinner(makeSession(makeAffinity()), 0);
    await recordAffinityWinner(makeSession(makeAffinity()), -1);
    expect(storeMocks.put).not.toHaveBeenCalled();
  });

  it("swallows store failures (fire-and-forget)", async () => {
    storeMocks.put.mockRejectedValueOnce(new Error("redis down"));
    await expect(recordAffinityWinner(makeSession(makeAffinity()), 42)).resolves.toBeUndefined();
    storeMocks.put.mockRejectedValueOnce("non-error failure");
    await expect(recordAffinityWinner(makeSession(makeAffinity()), 42)).resolves.toBeUndefined();
  });
});

describe("tombstoneAffinityOnFailure", () => {
  it("tombstones the matched boundary when the failed provider is the nominated one", async () => {
    const session = makeSession(makeAffinity({ nominatedProviderId: 42, matchedFp: "fp2" }));
    await tombstoneAffinityOnFailure(session, 42);
    expect(storeMocks.tombstone).toHaveBeenCalledTimes(1);
    expect(storeMocks.tombstone).toHaveBeenCalledWith("scope123", "fp2", "failover");
  });

  it("is a no-op when the failed provider differs from the nominated one", async () => {
    const session = makeSession(makeAffinity({ nominatedProviderId: 42, matchedFp: "fp2" }));
    await tombstoneAffinityOnFailure(session, 99);
    expect(storeMocks.tombstone).not.toHaveBeenCalled();
  });

  it("is a no-op without a nomination or a matched fingerprint", async () => {
    await tombstoneAffinityOnFailure(
      makeSession(makeAffinity({ nominatedProviderId: null, matchedFp: "fp2" })),
      42
    );
    await tombstoneAffinityOnFailure(
      makeSession(makeAffinity({ nominatedProviderId: 42, matchedFp: null })),
      42
    );
    expect(storeMocks.tombstone).not.toHaveBeenCalled();
  });

  it("is a no-op without affinity state (flag off never populates it)", async () => {
    await tombstoneAffinityOnFailure(makeSession(null), 42);
    expect(storeMocks.tombstone).not.toHaveBeenCalled();
  });

  it("swallows store failures", async () => {
    storeMocks.tombstone.mockRejectedValueOnce(new Error("redis down"));
    const session = makeSession(makeAffinity({ nominatedProviderId: 42, matchedFp: "fp2" }));
    await expect(tombstoneAffinityOnFailure(session, 42)).resolves.toBeUndefined();
    storeMocks.tombstone.mockRejectedValueOnce("non-error failure");
    await expect(tombstoneAffinityOnFailure(session, 42)).resolves.toBeUndefined();
  });
});
