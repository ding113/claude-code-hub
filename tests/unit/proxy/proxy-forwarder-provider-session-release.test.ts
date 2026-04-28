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

  it("同步 hedge 胜出 shadow session 时保留 releaseAgent cleanup 回调", async () => {
    const { ProxyForwarder } = await import("@/app/v1/_lib/proxy/forwarder");
    const forwarderInternals = ProxyForwarder as unknown as {
      syncWinningAttemptSession: (target: ProxySession, source: ProxySession) => void;
    };
    const clearResponseTimeout = vi.fn();
    const releaseAgent = vi.fn();
    const responseController = new AbortController();
    const setTargetCacheTtlResolved = vi.fn();
    const setTargetContext1mApplied = vi.fn();
    const target = {
      request: { message: null, buffer: null, log: null, note: null },
      requestUrl: new URL("https://example.com/v1/messages"),
      forwardedRequestBody: null,
      providerChain: [],
      specialSettings: [],
      originalModelName: null,
      originalUrlPathname: null,
      currentModelRedirect: null,
      getCacheTtlResolved: vi.fn(() => null),
      setCacheTtlResolved: setTargetCacheTtlResolved,
      getContext1mApplied: vi.fn(() => false),
      setContext1mApplied: setTargetContext1mApplied,
    } as unknown as ProxySession;
    const source = {
      request: { message: "winner", buffer: null, log: null, note: null },
      requestUrl: new URL("https://shadow.example.com/v1/messages"),
      forwardedRequestBody: '{"model":"winner"}',
      providerChain: [],
      specialSettings: [],
      originalModelName: "winner-model",
      originalUrlPathname: "/v1/messages",
      currentModelRedirect: null,
      getCacheTtlResolved: vi.fn(() => "5m"),
      setCacheTtlResolved: vi.fn(),
      getContext1mApplied: vi.fn(() => true),
      setContext1mApplied: vi.fn(),
      clearResponseTimeout,
      responseController,
      releaseAgent,
    } as unknown as ProxySession;

    forwarderInternals.syncWinningAttemptSession(target, source);

    expect(
      (target as ProxySession & { clearResponseTimeout?: () => void }).clearResponseTimeout
    ).toBe(clearResponseTimeout);
    expect(
      (target as ProxySession & { responseController?: AbortController }).responseController
    ).toBe(responseController);
    expect((target as ProxySession & { releaseAgent?: () => void }).releaseAgent).toBe(
      releaseAgent
    );
    expect(setTargetCacheTtlResolved).toHaveBeenCalledWith("5m");
    expect(setTargetContext1mApplied).toHaveBeenCalledWith(true);
  });
});
