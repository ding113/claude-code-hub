import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";

const mocks = vi.hoisted(() => ({
  releaseProviderSession: vi.fn(async (_providerId: number, _sessionId: string) => {}),
}));

vi.mock("@/lib/rate-limit/service", () => ({
  RateLimitService: {
    releaseProviderSession: mocks.releaseProviderSession,
  },
}));

describe("ProxyForwarder provider failure session release", () => {
  beforeEach(() => {
    mocks.releaseProviderSession.mockClear();
  });

  it("标记供应商失败时应同步释放 provider active session", async () => {
    const { ProxyForwarder } = await import("@/app/v1/_lib/proxy/forwarder");
    const forwarderInternals = ProxyForwarder as unknown as {
      markProviderFailed: (
        session: ProxySession,
        failedProviderIds: number[],
        providerId: number
      ) => Promise<void>;
    };
    const session = { sessionId: "sess_failed" } as unknown as ProxySession;
    const failedProviderIds: number[] = [];

    await forwarderInternals.markProviderFailed(session, failedProviderIds, 42);

    expect(failedProviderIds).toEqual([42]);
    expect(mocks.releaseProviderSession).toHaveBeenCalledWith(42, "sess_failed");
  });

  it("没有 sessionId 时只记录失败供应商，不触发 Redis 释放", async () => {
    const { ProxyForwarder } = await import("@/app/v1/_lib/proxy/forwarder");
    const forwarderInternals = ProxyForwarder as unknown as {
      markProviderFailed: (
        session: ProxySession,
        failedProviderIds: number[],
        providerId: number
      ) => Promise<void>;
    };
    const session = { sessionId: null } as unknown as ProxySession;
    const failedProviderIds: number[] = [];

    await forwarderInternals.markProviderFailed(session, failedProviderIds, 42);

    expect(failedProviderIds).toEqual([42]);
    expect(mocks.releaseProviderSession).not.toHaveBeenCalled();
  });
});
