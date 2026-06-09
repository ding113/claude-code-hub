import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/model-rate-limit/cache", () => ({ resolveModelLimits: vi.fn() }));
vi.mock("@/lib/model-rate-limit/bucket-service", () => ({
  BucketRateLimitService: { checkCostLimits: vi.fn() },
}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/utils/error-messages", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, getErrorMessageServer: async () => "model limit exceeded" };
});

import { ModelRateLimitGuard } from "@/app/v1/_lib/proxy/model-rate-limit-guard";
import { RateLimitError } from "@/app/v1/_lib/proxy/errors";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import { BucketRateLimitService } from "@/lib/model-rate-limit/bucket-service";
import { resolveModelLimits } from "@/lib/model-rate-limit/cache";
import type { ModelLimitBucket } from "@/lib/model-rate-limit/types";

const resolveMock = vi.mocked(resolveModelLimits);
const checkMock = vi.mocked(BucketRateLimitService.checkCostLimits);

function bucket(axis: "user" | "key", scopeId = axis === "user" ? 1 : 9): ModelLimitBucket {
  return {
    axis,
    scopeId,
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

interface FakeSession {
  authState: { user: { id: number; tags?: string[] }; key: { id: number } };
  getCurrentModel: () => string | null;
  provider: { id: number; modelRedirects?: unknown } | null;
  setResolvedModelLimits: ReturnType<typeof vi.fn>;
  setBypassUserGlobalCost: ReturnType<typeof vi.fn>;
  setBypassKeyGlobalCost: ReturnType<typeof vi.fn>;
  setProviderChangeListener: ReturnType<typeof vi.fn>;
}

function fakeSession(
  model: string | null = "opus",
  provider: FakeSession["provider"] = null
): FakeSession {
  return {
    authState: { user: { id: 1, tags: ["team-a"] }, key: { id: 9 } },
    getCurrentModel: () => model,
    provider,
    setResolvedModelLimits: vi.fn(),
    setBypassUserGlobalCost: vi.fn(),
    setBypassKeyGlobalCost: vi.fn(),
    setProviderChangeListener: vi.fn(),
  };
}

const run = (s: FakeSession) => ModelRateLimitGuard.execute(s as unknown as ProxySession);

describe("ModelRateLimitGuard — group-rate-limit (§5.2)", () => {
  beforeEach(() => {
    process.env.ENABLE_MODEL_RATE_LIMIT = "true";
    delete process.env.ENABLE_RATE_LIMIT;
    resolveMock.mockReset();
    checkMock.mockReset();
  });
  afterEach(() => {
    process.env.ENABLE_MODEL_RATE_LIMIT = undefined;
    process.env.MODEL_RATE_LIMIT_FAIL_OPEN = undefined;
  });

  it("flag off -> no-op, never resolves", async () => {
    process.env.ENABLE_MODEL_RATE_LIMIT = undefined;
    const s = fakeSession();
    await run(s);
    expect(resolveMock).not.toHaveBeenCalled();
    expect(s.setBypassUserGlobalCost).not.toHaveBeenCalled();
  });

  it("no buckets (model in no group, D9) -> no-op, no bypass", async () => {
    resolveMock.mockResolvedValue([]);
    const s = fakeSession();
    await run(s);
    expect(s.setResolvedModelLimits).not.toHaveBeenCalled();
    expect(s.setBypassUserGlobalCost).not.toHaveBeenCalled();
    expect(s.setBypassKeyGlobalCost).not.toHaveBeenCalled();
  });

  it("clean pass on the user bucket sets bypassUserGlobalCost", async () => {
    resolveMock.mockResolvedValue([bucket("user")]);
    checkMock.mockResolvedValue({ allowed: true, failOpen: false });
    const s = fakeSession();
    await run(s);
    expect(s.setResolvedModelLimits).toHaveBeenCalledWith([bucket("user")]);
    expect(s.setBypassUserGlobalCost).toHaveBeenCalledWith(true);
    expect(s.setBypassKeyGlobalCost).not.toHaveBeenCalled();
  });

  it("clean pass on the key bucket sets bypassKeyGlobalCost", async () => {
    resolveMock.mockResolvedValue([bucket("key")]);
    checkMock.mockResolvedValue({ allowed: true, failOpen: false });
    const s = fakeSession();
    await run(s);
    expect(s.setBypassKeyGlobalCost).toHaveBeenCalledWith(true);
    expect(s.setBypassUserGlobalCost).not.toHaveBeenCalled();
  });

  it("CRITICAL: fail-open pass must NOT set bypass (no double pass-through)", async () => {
    resolveMock.mockResolvedValue([bucket("user")]);
    checkMock.mockResolvedValue({ allowed: true, failOpen: true });
    const s = fakeSession();
    await run(s);
    expect(s.setBypassUserGlobalCost).not.toHaveBeenCalled();
    expect(s.setBypassKeyGlobalCost).not.toHaveBeenCalled();
  });

  it("fail-closed (MODEL_RATE_LIMIT_FAIL_OPEN=false): an unevaluable bucket is rejected", async () => {
    process.env.MODEL_RATE_LIMIT_FAIL_OPEN = "false";
    resolveMock.mockResolvedValue([bucket("user")]);
    checkMock.mockResolvedValue({ allowed: true, failOpen: true });
    const s = fakeSession();
    await expect(run(s)).rejects.toBeInstanceOf(RateLimitError);
    expect(s.setBypassUserGlobalCost).not.toHaveBeenCalled();
  });

  it("failover re-resolve (enforce:true) throws on a fallback-provider violation", async () => {
    resolveMock.mockResolvedValue([bucket("user")]);
    checkMock.mockResolvedValue({ allowed: true, failOpen: false });
    const s = fakeSession();
    await run(s); // initial clean pass; registers the provider-change listener
    const listener = s.setProviderChangeListener.mock.calls[0][0] as (
      s: ProxySession,
      o?: { enforce?: boolean }
    ) => Promise<void>;
    checkMock.mockResolvedValue({
      allowed: false,
      window: "daily",
      currentUsage: 31,
      limitValue: 30,
    });
    await expect(listener(s as unknown as ProxySession, { enforce: true })).rejects.toBeInstanceOf(
      RateLimitError
    );
  });

  it("hedge-winner re-resolve (no enforce) logs only, never throws", async () => {
    resolveMock.mockResolvedValue([bucket("user")]);
    checkMock.mockResolvedValue({ allowed: true, failOpen: false });
    const s = fakeSession();
    await run(s);
    const listener = s.setProviderChangeListener.mock.calls[0][0] as (
      s: ProxySession,
      o?: { enforce?: boolean }
    ) => Promise<void>;
    checkMock.mockResolvedValue({
      allowed: false,
      window: "daily",
      currentUsage: 31,
      limitValue: 30,
    });
    await expect(
      listener(s as unknown as ProxySession, { enforce: false })
    ).resolves.toBeUndefined();
  });

  it("violation throws a MODEL_* RateLimitError and sets no bypass", async () => {
    resolveMock.mockResolvedValue([bucket("user")]);
    checkMock.mockResolvedValue({
      allowed: false,
      window: "daily",
      currentUsage: 31,
      limitValue: 30,
    });
    const s = fakeSession();
    await expect(run(s)).rejects.toBeInstanceOf(RateLimitError);
    expect(s.setBypassUserGlobalCost).not.toHaveBeenCalled();
  });

  it("asymmetric: user clean pass + key fail-open -> only user bypass set", async () => {
    resolveMock.mockResolvedValue([bucket("user"), bucket("key")]);
    checkMock
      .mockResolvedValueOnce({ allowed: true, failOpen: false })
      .mockResolvedValueOnce({ allowed: true, failOpen: true });
    const s = fakeSession();
    await run(s);
    expect(s.setBypassUserGlobalCost).toHaveBeenCalledWith(true);
    expect(s.setBypassKeyGlobalCost).not.toHaveBeenCalled();
  });

  it("resolves with the provider-redirected upstream model (gate/writeback namespace match)", async () => {
    resolveMock.mockResolvedValue([]);
    const provider = {
      id: 42,
      modelRedirects: [
        { matchType: "exact", source: "claude-haiku-4-5-20251001", target: "glm-4.7" },
      ],
    };
    const s = fakeSession("claude-haiku-4-5-20251001", provider);
    await run(s);
    expect(resolveMock).toHaveBeenCalledTimes(1);
    const firstCall = resolveMock.mock.calls[0][0];
    expect(firstCall.model).toBe("glm-4.7");
  });

  it("falls back to the client model when no provider is selected", async () => {
    resolveMock.mockResolvedValue([]);
    const s = fakeSession("opus", null);
    await run(s);
    const firstCall = resolveMock.mock.calls[0][0];
    expect(firstCall.model).toBe("opus");
  });
});
