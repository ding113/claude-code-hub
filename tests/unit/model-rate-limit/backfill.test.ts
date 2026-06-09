import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/model-rate-limit/bucket-service", () => ({
  BucketRateLimitService: { decrementLease: vi.fn(async () => undefined) },
}));

import { modelBucketDecrements, resolveCountedFlags } from "@/lib/model-rate-limit/backfill";
import { BucketRateLimitService } from "@/lib/model-rate-limit/bucket-service";
import type { ModelLimitBucket } from "@/lib/model-rate-limit/types";

const decMock = vi.mocked(BucketRateLimitService.decrementLease);

function bucket(axis: "user" | "key"): ModelLimitBucket {
  return {
    axis,
    scopeId: axis === "user" ? 1 : 9,
    modelGroupId: 1,
    models: ["opus"],
    caps: {
      limit5hUsd: null,
      limit5hResetMode: "fixed",
      dailyLimitUsd: 30,
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      limit5hCostResetAt: null,
    },
  };
}

function session(opts: {
  bypassUser?: boolean;
  bypassKey?: boolean;
  buckets?: ModelLimitBucket[];
}) {
  return {
    getBypassUserGlobalCost: () => opts.bypassUser ?? false,
    getBypassKeyGlobalCost: () => opts.bypassKey ?? false,
    getResolvedModelLimits: () => opts.buckets ?? [],
  };
}

describe("resolveCountedFlags — §5.3 counted_in = !bypass", () => {
  it("no bypass -> both axes counted (mainline parity / default true)", () => {
    expect(resolveCountedFlags(session({}))).toEqual({
      countedInUserGlobal: true,
      countedInKeyGlobal: true,
    });
  });

  it("user split -> user not counted, key still counted (asymmetric, §5.3)", () => {
    expect(resolveCountedFlags(session({ bypassUser: true }))).toEqual({
      countedInUserGlobal: false,
      countedInKeyGlobal: true,
    });
  });

  it("both axes split -> neither counted", () => {
    expect(resolveCountedFlags(session({ bypassUser: true, bypassKey: true }))).toEqual({
      countedInUserGlobal: false,
      countedInKeyGlobal: false,
    });
  });
});

describe("modelBucketDecrements — §5.3 model buckets decremented unconditionally", () => {
  it("no resolved buckets -> empty array, no decrement calls", () => {
    decMock.mockClear();
    const out = modelBucketDecrements(session({}), 1.5);
    expect(out).toHaveLength(0);
    expect(decMock).not.toHaveBeenCalled();
  });

  it("decrements every resolved bucket even when its axis was split out", () => {
    decMock.mockClear();
    const buckets = [bucket("user"), bucket("key")];
    const out = modelBucketDecrements(session({ bypassUser: true, bypassKey: true, buckets }), 2.5);
    expect(out).toHaveLength(2);
    expect(decMock).toHaveBeenCalledTimes(2);
    expect(decMock).toHaveBeenCalledWith(buckets[0], 2.5);
    expect(decMock).toHaveBeenCalledWith(buckets[1], 2.5);
  });
});
