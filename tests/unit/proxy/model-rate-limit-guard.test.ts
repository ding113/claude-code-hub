import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/model-rate-limit/types", () => ({ isModelRateLimitEnabled: vi.fn(() => true) }));
vi.mock("@/lib/model-rate-limit/cache", () => ({ resolveModelLimits: vi.fn() }));
vi.mock("@/lib/model-rate-limit/bucket-service", () => ({
  BucketRateLimitService: { checkCostLimits: vi.fn() },
}));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "zh-CN") }));
vi.mock("@/lib/utils/error-messages", () => ({
  ERROR_CODES: {
    MODEL_RATE_LIMIT_5H_EXCEEDED: "MODEL_RATE_LIMIT_5H_EXCEEDED",
    MODEL_RATE_LIMIT_DAILY_QUOTA_EXCEEDED: "MODEL_RATE_LIMIT_DAILY_QUOTA_EXCEEDED",
    MODEL_RATE_LIMIT_WEEKLY_EXCEEDED: "MODEL_RATE_LIMIT_WEEKLY_EXCEEDED",
    MODEL_RATE_LIMIT_MONTHLY_EXCEEDED: "MODEL_RATE_LIMIT_MONTHLY_EXCEEDED",
    MODEL_RATE_LIMIT_TOTAL_EXCEEDED: "MODEL_RATE_LIMIT_TOTAL_EXCEEDED",
  },
  getErrorMessageServer: vi.fn(async () => "mock model limit message"),
}));

import { ModelRateLimitGuard } from "@/app/v1/_lib/proxy/model-rate-limit-guard";
import type { BucketCheckResult } from "@/lib/model-rate-limit/bucket-service";
import { BucketRateLimitService } from "@/lib/model-rate-limit/bucket-service";
import { resolveModelLimits } from "@/lib/model-rate-limit/cache";
import type { LimitAxis, ModelLimitBucket } from "@/lib/model-rate-limit/types";
import { isModelRateLimitEnabled } from "@/lib/model-rate-limit/types";

const resolve = vi.mocked(resolveModelLimits);
const checkCostLimits = vi.mocked(BucketRateLimitService.checkCostLimits);
const enabled = vi.mocked(isModelRateLimitEnabled);

function makeBucket(axis: LimitAxis, scopeId: number): ModelLimitBucket {
  return {
    axis,
    scopeId,
    modelGroupId: 1,
    models: ["gpt-x"],
    caps: {
      limit5hUsd: null,
      limit5hResetMode: "rolling",
      dailyLimitUsd: null,
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      limit5hCostResetAt: null,
    },
  };
}

function makeSession(overrides?: { model?: string | null; hasUser?: boolean; keyId?: number }) {
  const setBypassUserGlobalCost = vi.fn();
  const setBypassKeyGlobalCost = vi.fn();
  const setResolvedModelLimits = vi.fn();
  const session = {
    authState: {
      user: overrides?.hasUser === false ? undefined : { id: 1, tags: ["team-a"] },
      key: overrides?.keyId === undefined ? { id: 2 } : { id: overrides.keyId },
    },
    getCurrentModel: () => (overrides?.model === undefined ? "gpt-x" : overrides.model),
    setResolvedModelLimits,
    setBypassUserGlobalCost,
    setBypassKeyGlobalCost,
  } as never;
  return {
    session,
    setBypassUserGlobalCost,
    setBypassKeyGlobalCost,
    setResolvedModelLimits,
  };
}

const ALLOWED: BucketCheckResult = { allowed: true, failOpen: false };

beforeEach(() => {
  vi.clearAllMocks();
  enabled.mockReturnValue(true);
});

describe("ModelRateLimitGuard - no-op paths (D9)", () => {
  it("returns null and does not resolve when the feature is disabled", async () => {
    enabled.mockReturnValue(false);
    const { session } = makeSession();
    expect(await ModelRateLimitGuard.execute(session)).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("returns null when the request has no model", async () => {
    const { session } = makeSession({ model: null });
    expect(await ModelRateLimitGuard.execute(session)).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("returns null when the model belongs to no configured group", async () => {
    resolve.mockResolvedValue([]);
    const { session, setBypassUserGlobalCost, setBypassKeyGlobalCost } = makeSession();
    expect(await ModelRateLimitGuard.execute(session)).toBeNull();
    expect(setBypassUserGlobalCost).not.toHaveBeenCalled();
    expect(setBypassKeyGlobalCost).not.toHaveBeenCalled();
  });
});

describe("ModelRateLimitGuard - complete-split flag production (§5.2/§5.3)", () => {
  it("sets the user bypass flag on a clean user-axis pass", async () => {
    resolve.mockResolvedValue([makeBucket("user", 1)]);
    checkCostLimits.mockResolvedValue(ALLOWED);
    const { session, setBypassUserGlobalCost, setBypassKeyGlobalCost, setResolvedModelLimits } =
      makeSession();

    expect(await ModelRateLimitGuard.execute(session)).toBeNull();
    expect(setResolvedModelLimits).toHaveBeenCalledTimes(1);
    expect(setBypassUserGlobalCost).toHaveBeenCalledWith(true);
    expect(setBypassKeyGlobalCost).not.toHaveBeenCalled();
  });

  it("sets the key bypass flag on a clean key-axis pass", async () => {
    resolve.mockResolvedValue([makeBucket("key", 2)]);
    checkCostLimits.mockResolvedValue(ALLOWED);
    const { session, setBypassUserGlobalCost, setBypassKeyGlobalCost } = makeSession();

    await ModelRateLimitGuard.execute(session);
    expect(setBypassKeyGlobalCost).toHaveBeenCalledWith(true);
    expect(setBypassUserGlobalCost).not.toHaveBeenCalled();
  });

  it("CRITICAL: a fail-open bucket does NOT set the bypass flag", async () => {
    resolve.mockResolvedValue([makeBucket("user", 1)]);
    checkCostLimits.mockResolvedValue({ allowed: true, failOpen: true });
    const { session, setBypassUserGlobalCost } = makeSession();

    await ModelRateLimitGuard.execute(session);
    expect(setBypassUserGlobalCost).not.toHaveBeenCalled();
  });

  it("sets both axis flags when both a user and a key bucket pass", async () => {
    resolve.mockResolvedValue([makeBucket("user", 1), makeBucket("key", 2)]);
    checkCostLimits.mockResolvedValue(ALLOWED);
    const { session, setBypassUserGlobalCost, setBypassKeyGlobalCost } = makeSession();

    await ModelRateLimitGuard.execute(session);
    expect(setBypassUserGlobalCost).toHaveBeenCalledWith(true);
    expect(setBypassKeyGlobalCost).toHaveBeenCalledWith(true);
  });
});

describe("ModelRateLimitGuard - violations throw MODEL_* errors", () => {
  it("maps the daily window to a daily_quota RateLimitError with usage/limit", async () => {
    resolve.mockResolvedValue([makeBucket("user", 1)]);
    checkCostLimits.mockResolvedValue({
      allowed: false,
      window: "daily",
      currentUsage: 30,
      limitValue: 10,
    });
    const { session, setBypassUserGlobalCost } = makeSession();

    await expect(ModelRateLimitGuard.execute(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "daily_quota",
      currentUsage: 30,
      limitValue: 10,
    });
    expect(setBypassUserGlobalCost).not.toHaveBeenCalled();
  });

  it("defaults to the total window mapping when window is absent", async () => {
    resolve.mockResolvedValue([makeBucket("key", 2)]);
    checkCostLimits.mockResolvedValue({ allowed: false });
    const { session } = makeSession();

    await expect(ModelRateLimitGuard.execute(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "usd_total",
      currentUsage: 0,
      limitValue: 0,
    });
  });
});
