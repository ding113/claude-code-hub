import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";

const circuitBreakerMocks = vi.hoisted(() => ({
  isCircuitOpen: vi.fn(async () => false),
  getCircuitState: vi.fn(() => "closed"),
}));

vi.mock("@/lib/circuit-breaker", () => circuitBreakerMocks);

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

const rateLimitMocks = vi.hoisted(() => ({
  RateLimitService: {
    checkAndTrackProviderUa: vi.fn(async () => ({ allowed: true, count: 0, tracked: false })),
    checkAndTrackProviderSession: vi.fn(async () => ({ allowed: true, count: 0, tracked: false })),
    untrackProviderUa: vi.fn(async () => true),
    checkCostLimitsWithLease: vi.fn(async () => ({ allowed: true })),
    checkTotalCostLimit: vi.fn(async () => ({ allowed: true, current: 0 })),
  },
}));

vi.mock("@/lib/rate-limit", () => rateLimitMocks);

const sessionManagerMocks = vi.hoisted(() => ({
  SessionManager: {
    getSessionProvider: vi.fn(async () => null as number | null),
    clearSessionProvider: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/session-manager", () => sessionManagerMocks);

vi.mock("@/repository/provider", () => ({
  findAllProviders: vi.fn(async () => []),
  findProviderById: vi.fn(async () => null),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(async () => ({ verboseProviderError: false })),
}));

vi.mock("@/lib/utils/provider-schedule", () => ({
  isProviderActiveNow: vi.fn(() => true),
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn(async () => "Asia/Shanghai"),
}));

vi.mock("@/lib/vendor-type-circuit-breaker", () => ({
  isVendorTypeCircuitOpen: vi.fn(async () => false),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ProxyProviderResolver.ensure - concurrent UA fallback", () => {
  test("供应商并发 UA 超限时应回退到下一个供应商，且不先执行并发 Session 追踪", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const provider1 = {
      id: 1,
      name: "p1",
      providerType: "claude",
      groupTag: null,
      weight: 1,
      priority: 0,
      costMultiplier: 1,
      isEnabled: true,
      limitConcurrentSessions: 10,
      limitConcurrentUas: 1,
    } as unknown as Provider;

    const provider2 = {
      ...provider1,
      id: 2,
      name: "p2",
      limitConcurrentUas: 1,
    } as unknown as Provider;

    const excludeSnapshots: number[][] = [];
    const pickRandomProviderMock = vi
      .spyOn(ProxyProviderResolver as any, "pickRandomProvider")
      .mockImplementationOnce(async (_session: unknown, excludeIds: number[] = []) => {
        excludeSnapshots.push([...excludeIds]);
        return { provider: provider1, context: { groupFilterApplied: false } };
      })
      .mockImplementationOnce(async (_session: unknown, excludeIds: number[] = []) => {
        excludeSnapshots.push([...excludeIds]);
        return { provider: provider2, context: { groupFilterApplied: false } };
      });

    rateLimitMocks.RateLimitService.checkAndTrackProviderUa
      .mockResolvedValueOnce({
        allowed: false,
        count: 1,
        tracked: false,
        reasonCode: "RATE_LIMIT_CONCURRENT_UAS_EXCEEDED",
        reasonParams: { current: 1, limit: 1 },
      })
      .mockResolvedValueOnce({ allowed: true, count: 1, tracked: true });

    rateLimitMocks.RateLimitService.checkAndTrackProviderSession.mockResolvedValueOnce({
      allowed: true,
      count: 1,
      tracked: true,
    });

    const providerChain: Array<Parameters<ProxySession["addProviderToChain"]>[1]> = [];
    let lastContext: ReturnType<ProxySession["getLastSelectionContext"]>;

    const session: Partial<ProxySession> = {
      sessionId: "s1",
      userAgent: "claude-cli/2.0.32 (external, cli)",
      authState: null,
      provider: null,
      shouldReuseProvider: () => false,
      getOriginalModel: () => null,
      getCurrentModel: () => null,
      setProvider: (p: Provider | null) => {
        session.provider = p;
      },
      setLastSelectionContext: (ctx: Parameters<ProxySession["setLastSelectionContext"]>[0]) => {
        lastContext = ctx;
      },
      getLastSelectionContext: () => lastContext,
      addProviderToChain: (
        _provider: Provider,
        item?: Parameters<ProxySession["addProviderToChain"]>[1]
      ) => {
        providerChain.push(item);
      },
    };

    await expect(ProxyProviderResolver.ensure(session as ProxySession)).resolves.toBeNull();
    expect(session.provider?.id).toBe(2);

    expect(pickRandomProviderMock).toHaveBeenCalledTimes(2);
    expect(excludeSnapshots).toEqual([[], [1]]);

    expect(rateLimitMocks.RateLimitService.checkAndTrackProviderUa).toHaveBeenCalledTimes(2);
    const uaCall1 = rateLimitMocks.RateLimitService.checkAndTrackProviderUa.mock.calls[0]!;
    const uaCall2 = rateLimitMocks.RateLimitService.checkAndTrackProviderUa.mock.calls[1]!;
    expect(uaCall1[0]).toBe(1);
    expect(uaCall2[0]).toBe(2);
    expect(uaCall1[1]).toBe(uaCall2[1]); // UA 标识应稳定
    expect(uaCall1[2]).toBe(1);

    expect(rateLimitMocks.RateLimitService.checkAndTrackProviderSession).toHaveBeenCalledTimes(1);
    expect(rateLimitMocks.RateLimitService.checkAndTrackProviderSession).toHaveBeenCalledWith(
      2,
      "s1",
      10
    );

    pickRandomProviderMock.mockRestore();
    expect(providerChain.length).toBeGreaterThan(0);
  });

  test("供应商并发 Session 超限触发回退时，应回滚本次新增的 Provider UA 追踪", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const provider1 = {
      id: 1,
      name: "p1",
      providerType: "claude",
      groupTag: null,
      weight: 1,
      priority: 0,
      costMultiplier: 1,
      isEnabled: true,
      limitConcurrentSessions: 1,
      limitConcurrentUas: 10,
    } as unknown as Provider;

    const provider2 = {
      ...provider1,
      id: 2,
      name: "p2",
    } as unknown as Provider;

    const excludeSnapshots: number[][] = [];
    const pickRandomProviderMock = vi
      .spyOn(ProxyProviderResolver as any, "pickRandomProvider")
      .mockImplementationOnce(async (_session: unknown, excludeIds: number[] = []) => {
        excludeSnapshots.push([...excludeIds]);
        return { provider: provider1, context: { groupFilterApplied: false } };
      })
      .mockImplementationOnce(async (_session: unknown, excludeIds: number[] = []) => {
        excludeSnapshots.push([...excludeIds]);
        return { provider: provider2, context: { groupFilterApplied: false } };
      });

    rateLimitMocks.RateLimitService.checkAndTrackProviderUa
      .mockResolvedValueOnce({ allowed: true, count: 1, tracked: true, trackedAtMs: 123 })
      .mockResolvedValueOnce({ allowed: true, count: 1, tracked: false });

    rateLimitMocks.RateLimitService.checkAndTrackProviderSession
      .mockResolvedValueOnce({
        allowed: false,
        count: 1,
        tracked: false,
        reason: "供应商并发 Session 上限已达到（1/1）",
      })
      .mockResolvedValueOnce({ allowed: true, count: 1, tracked: true });

    const session: Partial<ProxySession> = {
      sessionId: "s1",
      userAgent: "claude-cli/2.0.32 (external, cli)",
      authState: null,
      provider: null,
      shouldReuseProvider: () => false,
      getOriginalModel: () => null,
      getCurrentModel: () => null,
      setProvider: (p: Provider | null) => {
        session.provider = p;
      },
      setLastSelectionContext: () => undefined,
      getLastSelectionContext: () => undefined,
      addProviderToChain: () => undefined,
    };

    await expect(ProxyProviderResolver.ensure(session as ProxySession)).resolves.toBeNull();
    expect(session.provider?.id).toBe(2);

    expect(pickRandomProviderMock).toHaveBeenCalledTimes(2);
    expect(excludeSnapshots).toEqual([[], [1]]);

    const uaId = rateLimitMocks.RateLimitService.checkAndTrackProviderUa.mock.calls[0]?.[1];
    expect(uaId).toBeTypeOf("string");

    expect(rateLimitMocks.RateLimitService.untrackProviderUa).toHaveBeenCalledTimes(1);
    expect(rateLimitMocks.RateLimitService.untrackProviderUa).toHaveBeenCalledWith(1, uaId, 123);

    pickRandomProviderMock.mockRestore();
  });
});
