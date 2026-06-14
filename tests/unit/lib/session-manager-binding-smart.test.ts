import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for SessionManager.updateSessionBindingSmart forceUpdate semantics.
 *
 * Hedge race winners must unconditionally rebind the session-reuse binding to
 * the winner. forceUpdate short-circuits the smart-decision path (priority /
 * circuit health) that would otherwise keep a healthy higher-priority binding.
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
const TTL = 300;

beforeEach(() => {
  vi.clearAllMocks();
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
    redisClientRef!.get.mockResolvedValue("1");
    vi.mocked(findProviderById).mockResolvedValue({ id: 1, name: "main", priority: 5 } as never);
    vi.mocked(isCircuitOpen).mockResolvedValue(false);

    const result = await SessionManager.updateSessionBindingSmart(
      SID,
      2, // winner id
      10, // winner priority (lower priority than current's 5)
      false, // isFirstAttempt
      false, // isFailoverSuccess
      null,
      true // forceUpdate
    );

    expect(result).toMatchObject({ updated: true, reason: "race_winner_forced" });
    expect(lastPipeline.setex).toHaveBeenCalledWith(`session:${SID}:provider`, TTL, "2");
    // Guard against a regression that queues setex but forgets to flush the pipeline.
    expect(lastPipeline.exec).toHaveBeenCalledTimes(1);
  });

  it("forceUpdate=true rebinds even when the winner equals the current binding", async () => {
    // Production winner==initialProvider race: the bound provider is already the winner,
    // but the race result must still (re)write the binding and refresh its TTL.
    redisClientRef!.get.mockResolvedValue("2");

    const result = await SessionManager.updateSessionBindingSmart(
      SID,
      2, // winner id == currently bound id
      10,
      false,
      false,
      null,
      true // forceUpdate
    );

    expect(result).toMatchObject({ updated: true, reason: "race_winner_forced" });
    expect(redisClientRef!.get).not.toHaveBeenCalled();
    expect(lastPipeline.setex).toHaveBeenCalledWith(`session:${SID}:provider`, TTL, "2");
    expect(lastPipeline.exec).toHaveBeenCalledTimes(1);
  });

  it("forceUpdate=false keeps the healthy higher-priority binding (documents the gap)", async () => {
    redisClientRef!.get.mockResolvedValue("1");
    vi.mocked(findProviderById).mockResolvedValue({ id: 1, name: "main", priority: 5 } as never);
    vi.mocked(isCircuitOpen).mockResolvedValue(false);

    const result = await SessionManager.updateSessionBindingSmart(
      SID,
      2,
      10,
      false,
      false,
      null,
      false // forceUpdate
    );

    expect(result).toMatchObject({ updated: false, reason: "keep_healthy_higher_priority" });
  });

  it("forceUpdate=true short-circuits before consulting provider/circuit state", async () => {
    redisClientRef!.get.mockResolvedValue("1");

    await SessionManager.updateSessionBindingSmart(SID, 2, 10, false, false, null, true);

    expect(findProviderById).not.toHaveBeenCalled();
    expect(isCircuitOpen).not.toHaveBeenCalled();
    // forceUpdate goes straight to the unconditional pipeline path.
    expect(redisClientRef!.get).not.toHaveBeenCalled();
  });

  it("forceUpdate=true also persists the keyId binding with TTL", async () => {
    const result = await SessionManager.updateSessionBindingSmart(
      SID,
      2,
      10,
      false,
      false,
      42, // keyId
      true
    );

    expect(result.updated).toBe(true);
    expect(lastPipeline.setex).toHaveBeenCalledWith(`session:${SID}:provider`, TTL, "2");
    expect(lastPipeline.setex).toHaveBeenCalledWith(`session:${SID}:key`, TTL, "42");
    expect(lastPipeline.exec).toHaveBeenCalledTimes(1);
  });

  it("isFailoverSuccess=true keeps reason failover_success even when forceUpdate=true", async () => {
    const result = await SessionManager.updateSessionBindingSmart(
      SID,
      2,
      10,
      false,
      true, // isFailoverSuccess
      null,
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
});
