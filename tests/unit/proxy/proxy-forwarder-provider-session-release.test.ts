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

vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {
    releaseProviderSession: mocks.releaseProviderSession,
  },
}));

describe("ProxyForwarder provider failure session release", () => {
  beforeEach(() => {
    mocks.releaseProviderSession.mockClear();
  });

  it("标记供应商失败时仅释放本请求已获取的 provider session ref", async () => {
    const { ProxyForwarder } = await import("@/app/v1/_lib/proxy/forwarder");
    const forwarderInternals = ProxyForwarder as unknown as {
      markProviderFailed: (
        session: ProxySession,
        failedProviderIds: number[],
        providerId: number
      ) => void;
    };
    const consumeProviderSessionRef = vi.fn(() => true);
    const session = {
      sessionId: "sess_failed",
      consumeProviderSessionRef,
    } as unknown as ProxySession;
    const failedProviderIds: number[] = [];

    forwarderInternals.markProviderFailed(session, failedProviderIds, 42);

    expect(failedProviderIds).toEqual([42]);
    expect(consumeProviderSessionRef).toHaveBeenCalledWith(42);
    expect(mocks.releaseProviderSession).toHaveBeenCalledWith(42, "sess_failed");
  });

  it("未获取 provider session ref 的 fallback/hedge provider 不应释放 Redis membership", async () => {
    const { ProxyForwarder } = await import("@/app/v1/_lib/proxy/forwarder");
    const forwarderInternals = ProxyForwarder as unknown as {
      markProviderFailed: (
        session: ProxySession,
        failedProviderIds: number[],
        providerId: number
      ) => void;
    };
    const consumeProviderSessionRef = vi.fn(() => false);
    const session = {
      sessionId: "sess_failed",
      consumeProviderSessionRef,
    } as unknown as ProxySession;
    const failedProviderIds: number[] = [];

    forwarderInternals.markProviderFailed(session, failedProviderIds, 42);

    expect(failedProviderIds).toEqual([42]);
    expect(consumeProviderSessionRef).toHaveBeenCalledWith(42);
    expect(mocks.releaseProviderSession).not.toHaveBeenCalled();
  });

  it("重复标记同一供应商时只释放一次，避免 hedge 路径重复 ZREM", async () => {
    const { ProxyForwarder } = await import("@/app/v1/_lib/proxy/forwarder");
    const forwarderInternals = ProxyForwarder as unknown as {
      markProviderFailed: (
        session: ProxySession,
        failedProviderIds: number[],
        providerId: number
      ) => void;
    };
    const consumeProviderSessionRef = vi.fn(() => true);
    const session = {
      sessionId: "sess_failed",
      consumeProviderSessionRef,
    } as unknown as ProxySession;
    const failedProviderIds: number[] = [];

    forwarderInternals.markProviderFailed(session, failedProviderIds, 42);
    forwarderInternals.markProviderFailed(session, failedProviderIds, 42);

    expect(failedProviderIds).toEqual([42]);
    expect(consumeProviderSessionRef).toHaveBeenCalledTimes(1);
    expect(mocks.releaseProviderSession).toHaveBeenCalledTimes(1);
  });

  it("没有 sessionId 时只记录失败供应商，不触发 Redis 释放", async () => {
    const { ProxyForwarder } = await import("@/app/v1/_lib/proxy/forwarder");
    const forwarderInternals = ProxyForwarder as unknown as {
      markProviderFailed: (
        session: ProxySession,
        failedProviderIds: number[],
        providerId: number
      ) => void;
    };
    const session = { sessionId: null } as unknown as ProxySession;
    const failedProviderIds: number[] = [];

    forwarderInternals.markProviderFailed(session, failedProviderIds, 42);

    expect(failedProviderIds).toEqual([42]);
    expect(mocks.releaseProviderSession).not.toHaveBeenCalled();
  });
});
