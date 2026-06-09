import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRedis = vi.hoisted(() => ({
  status: "ready" as string,
  get: vi.fn(),
  ttl: vi.fn(),
  setex: vi.fn(),
  eval: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({ getRedisClient: () => mockRedis }));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("ModelLeaseService.decrementLeaseBudget — shared atomic Lua decrement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.status = "ready";
  });
  afterEach(() => vi.restoreAllMocks());

  it("fails open when Redis is not ready", async () => {
    mockRedis.status = "connecting";
    const { ModelLeaseService } = await import("@/lib/model-rate-limit/lease");

    const result = await ModelLeaseService.decrementLeaseBudget({
      scopeType: "user",
      scopeId: 7,
      model: "claude-opus-4",
      window: "weekly",
      cost: 1,
    });

    expect(result).toMatchObject({ success: true, failOpen: true });
  });

  it("decrements atomically via the Lua script on success", async () => {
    // Lua returns string tuples to preserve fractional precision.
    mockRedis.eval.mockResolvedValue(["4.5", "1"]);
    const { ModelLeaseService } = await import("@/lib/model-rate-limit/lease");

    const result = await ModelLeaseService.decrementLeaseBudget({
      scopeType: "user",
      scopeId: 7,
      model: "claude-opus-4",
      window: "weekly",
      cost: 0.5,
    });

    expect(result).toMatchObject({ success: true, newRemaining: 4.5 });
    expect(mockRedis.eval).toHaveBeenCalledOnce();
  });

  it("uses the lease key override verbatim (group bucket reuse)", async () => {
    mockRedis.eval.mockResolvedValue(["2", "1"]);
    const { ModelLeaseService } = await import("@/lib/model-rate-limit/lease");

    await ModelLeaseService.decrementLeaseBudget({
      scopeType: "user",
      scopeId: 7,
      model: "",
      window: "daily",
      cost: 1,
      leaseKeyOverride: "lease:user-mg:7:1:daily:fixed",
    });

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "lease:user-mg:7:1:daily:fixed",
      "1"
    );
  });
});
