/**
 * Tests for hedge winner duplicate provider chain entry fix.
 *
 * Bug: When a streaming hedge request wins, commitWinner() logs the provider with
 * reason "hedge_winner", then finalizeDeferredStreamingFinalizationIfNeeded() logs
 * the same provider again with reason "retry_success". The dedup logic in
 * addProviderToChain() doesn't catch this because "hedge_winner" !== "retry_success".
 *
 * Fix: Add isHedgeWinner flag to DeferredStreamingFinalization so finalization
 * can skip duplicate session binding, provider update, and chain logging.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types/provider";

// ── stream-finalization round-trip ──────────────────────────────────

describe("DeferredStreamingFinalization isHedgeWinner flag", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should preserve isHedgeWinner=true through set/consume cycle", async () => {
    const { setDeferredStreamingFinalization, consumeDeferredStreamingFinalization } = await import(
      "@/app/v1/_lib/proxy/stream-finalization"
    );

    const fakeSession = {} as Parameters<typeof setDeferredStreamingFinalization>[0];

    setDeferredStreamingFinalization(fakeSession, {
      providerId: 1,
      providerName: "test",
      providerPriority: 10,
      attemptNumber: 1,
      totalProvidersAttempted: 2,
      isFirstAttempt: false,
      isFailoverSuccess: false,
      endpointId: null,
      endpointUrl: "https://api.example.com",
      upstreamStatusCode: 200,
      isHedgeWinner: true,
    });

    const meta = consumeDeferredStreamingFinalization(fakeSession);
    expect(meta).not.toBeNull();
    expect(meta!.isHedgeWinner).toBe(true);
  });

  it("should preserve isHedgeWinner=false (non-hedge) through set/consume cycle", async () => {
    const { setDeferredStreamingFinalization, consumeDeferredStreamingFinalization } = await import(
      "@/app/v1/_lib/proxy/stream-finalization"
    );

    const fakeSession = {} as Parameters<typeof setDeferredStreamingFinalization>[0];

    setDeferredStreamingFinalization(fakeSession, {
      providerId: 1,
      providerName: "test",
      providerPriority: 10,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: null,
      endpointUrl: "https://api.example.com",
      upstreamStatusCode: 200,
      isHedgeWinner: false,
    });

    const meta = consumeDeferredStreamingFinalization(fakeSession);
    expect(meta).not.toBeNull();
    expect(meta!.isHedgeWinner).toBe(false);
  });

  it("should default isHedgeWinner to undefined when not set", async () => {
    const { setDeferredStreamingFinalization, consumeDeferredStreamingFinalization } = await import(
      "@/app/v1/_lib/proxy/stream-finalization"
    );

    const fakeSession = {} as Parameters<typeof setDeferredStreamingFinalization>[0];

    setDeferredStreamingFinalization(fakeSession, {
      providerId: 1,
      providerName: "test",
      providerPriority: 10,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: null,
      endpointUrl: "https://api.example.com",
      upstreamStatusCode: 200,
    });

    const meta = consumeDeferredStreamingFinalization(fakeSession);
    expect(meta).not.toBeNull();
    expect(meta!.isHedgeWinner).toBeUndefined();
  });
});

// ── addProviderToChain dedup gap (documents the bug) ────────────────

// These mocks must be declared before importing ProxySession
vi.mock("@/repository/model-price", () => ({
  findLatestPriceByModel: vi.fn(),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(),
}));

vi.mock("@/repository/provider", () => ({
  findAllProviders: vi.fn(async () => []),
}));

vi.mock("@/lib/redis/live-chain-store", () => ({
  writeLiveChain: vi.fn(),
}));

import { ProxySession } from "@/app/v1/_lib/proxy/session";

const makeProvider = (id: number, name: string): Provider =>
  ({
    id,
    name,
    providerVendorId: 100,
    providerType: "claude",
    priority: 10,
    weight: 1,
    costMultiplier: 1,
    groupTag: null,
    isEnabled: true,
  }) as unknown as Provider;

function createSession(): ProxySession {
  return new (
    ProxySession as unknown as {
      new (init: {
        startTime: number;
        method: string;
        requestUrl: URL;
        headers: Headers;
        headerLog: string;
        request: { message: Record<string, unknown>; log: string; model: string | null };
        userAgent: string | null;
        context: unknown;
        clientAbortSignal: AbortSignal | null;
      }): ProxySession;
    }
  )({
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("http://localhost/v1/messages"),
    headers: new Headers(),
    headerLog: "",
    request: { message: {}, log: "(test)", model: "test-model" },
    userAgent: null,
    context: {},
    clientAbortSignal: null,
  });
}

describe("addProviderToChain dedup behavior with hedge reasons", () => {
  it("same provider with hedge_winner then retry_success produces duplicate (documents bug)", () => {
    const session = createSession();
    const provider = makeProvider(1, "Provider A");

    // commitWinner logs with hedge_winner
    session.addProviderToChain(provider, {
      reason: "hedge_winner",
      attemptNumber: 1,
      statusCode: 200,
      endpointId: 10,
      endpointUrl: "https://api.example.com",
    });

    // finalization would log with retry_success (the bug)
    session.addProviderToChain(provider, {
      reason: "retry_success",
      attemptNumber: 1,
      statusCode: 200,
      endpointId: 10,
      endpointUrl: "https://api.example.com",
    });

    const chain = session.getProviderChain();
    // Documents the current (broken) behavior: 2 entries for the same provider.
    // After the fix, finalization won't call addProviderToChain for hedge winners,
    // so this scenario won't arise in practice.
    expect(chain).toHaveLength(2);
    expect(chain[0].reason).toBe("hedge_winner");
    expect(chain[1].reason).toBe("retry_success");
  });

  it("same provider with identical reason and attemptNumber deduplicates correctly", () => {
    const session = createSession();
    const provider = makeProvider(1, "Provider A");

    session.addProviderToChain(provider, {
      reason: "request_success",
      attemptNumber: 1,
      statusCode: 200,
      endpointId: 10,
      endpointUrl: "https://api.example.com",
    });

    // Same reason + same attemptNumber -> should dedup
    session.addProviderToChain(provider, {
      reason: "request_success",
      attemptNumber: 1,
      statusCode: 200,
      endpointId: 10,
      endpointUrl: "https://api.example.com",
    });

    const chain = session.getProviderChain();
    expect(chain).toHaveLength(1);
    expect(chain[0].reason).toBe("request_success");
  });

  it("non-hedge finalization should add entry to chain normally", () => {
    const session = createSession();
    const provider = makeProvider(1, "Provider A");

    session.addProviderToChain(provider, {
      reason: "request_success",
      attemptNumber: 1,
      statusCode: 200,
      endpointId: 10,
      endpointUrl: "https://api.example.com",
    });

    const chain = session.getProviderChain();
    expect(chain).toHaveLength(1);
    expect(chain[0].reason).toBe("request_success");
  });
});
