import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { normalizeRoutingTrace, ROUTING_TRACE_MAX_EVENTS } from "@/types/routing-trace";
import type { SystemSettings } from "@/types/system-config";

const liveChainMocks = vi.hoisted(() => ({
  deleteLiveChain: vi.fn(async () => undefined),
  writeLiveChain: vi.fn(async () => undefined),
  writeLiveRoutingTrace: vi.fn(async () => undefined),
}));

vi.mock("@/lib/redis/live-chain-store", () => liveChainMocks);

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { logger } from "@/lib/logger";

type PrepareStreamingDiscovery = (
  session: ProxySession,
  settings: SystemSettings,
  requestStartedAt: number
) => Promise<{ status: "prepared"; prepared: unknown } | { status: "skipped"; reason: string }>;

function prepareStreamingDiscovery(): PrepareStreamingDiscovery {
  return (
    ProxyForwarder as unknown as {
      prepareStreamingDiscovery: PrepareStreamingDiscovery;
    }
  ).prepareStreamingDiscovery;
}

function makePreparationSession(stream: boolean): ProxySession {
  return {
    request: { message: { stream } },
    originalFormat: "claude",
    getEndpointPolicy: () => resolveEndpointPolicy("/v1/messages"),
  } as unknown as ProxySession;
}

function makeTraceSession(startTime = 1_000): ProxySession {
  const session = Object.create(ProxySession.prototype) as ProxySession;
  Object.assign(session, {
    startTime,
    sessionId: "routing-trace-session",
    requestSequence: 7,
    highConcurrencyModeEnabled: false,
    routingTrace: null,
    liveChainDirty: false,
    liveRoutingTraceDirty: false,
    liveObservabilityFlushPromise: null,
    liveObservabilityClosePromise: null,
    liveObservabilityClosed: false,
    routingTraceTerminalLogged: false,
    providerChain: [],
    ttfbMs: null,
  });
  return session;
}

describe("routing trace Discovery preparation", () => {
  it("reports disabled before touching request-specific eligibility", async () => {
    const result = await prepareStreamingDiscovery()(
      {} as ProxySession,
      { discoveryEnabled: false } as SystemSettings,
      1_000
    );

    expect(result).toEqual({ status: "skipped", reason: "disabled" });
  });

  it("reports non_streaming for an otherwise supported endpoint and protocol", async () => {
    const result = await prepareStreamingDiscovery()(
      makePreparationSession(false),
      { discoveryEnabled: true } as SystemSettings,
      1_000
    );

    expect(result).toEqual({ status: "skipped", reason: "non_streaming" });
  });
});

describe("ProxySession routing trace recorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves a focused Discovery lifecycle order through terminal finalization", () => {
    const session = makeTraceSession();
    session.initializeRoutingTrace({
      mode: "discovery",
      discoveryEnabled: true,
      eligible: true,
      startedAt: 1_000,
    });

    session.appendRoutingTraceEvent({
      type: "round_started",
      round: 1,
      at: 1_010,
    });
    session.appendRoutingTraceEvent({
      type: "attempt_started",
      round: 1,
      attemptId: "attempt-1",
      attemptKind: "normal",
      provider: { id: 11, name: "Provider 11", priority: 1 },
      at: 1_020,
    });
    session.appendRoutingTraceEvent({
      type: "attempt_ready",
      round: 1,
      attemptId: "attempt-1",
      attemptKind: "normal",
      provider: { id: 11, name: "Provider 11", priority: 1 },
      at: 1_030,
    });
    session.appendRoutingTraceEvent({
      type: "attempt_finished",
      round: 1,
      attemptId: "attempt-1",
      attemptKind: "normal",
      provider: { id: 11, name: "Provider 11", priority: 1 },
      outcome: "winner",
      at: 1_040,
    });
    session.appendRoutingTraceEvent({
      type: "winner_committed",
      round: 1,
      attemptId: "attempt-1",
      attemptKind: "normal",
      provider: { id: 11, name: "Provider 11", priority: 1 },
      statusCode: 200,
      at: 1_050,
    });
    session.finalizeRoutingTrace(200, "success");

    expect(session.getRoutingTrace()?.events.map((event) => event.type)).toEqual([
      "request_started",
      "round_started",
      "attempt_started",
      "attempt_ready",
      "attempt_finished",
      "winner_committed",
      "request_finished",
    ]);
    expect(session.getRoutingTrace()?.events.at(-1)).toMatchObject({
      type: "request_finished",
      outcome: "success",
      statusCode: 200,
    });
  });

  it("caps the trace at 512 events and persists the truncated snapshot independently", async () => {
    const session = makeTraceSession();
    session.initializeRoutingTrace({
      mode: "discovery",
      discoveryEnabled: true,
      eligible: true,
      startedAt: 1_000,
    });

    for (let index = 1; index <= ROUTING_TRACE_MAX_EVENTS; index += 1) {
      session.appendRoutingTraceEvent({
        type: "attempt_started",
        attemptId: `attempt-${index}`,
        attemptKind: "normal",
        provider: { id: index },
        at: 1_000 + index,
      });
    }
    await vi.waitFor(() => expect(liveChainMocks.writeLiveRoutingTrace).toHaveBeenCalled());
    const writesAtLimit = liveChainMocks.writeLiveRoutingTrace.mock.calls.length;
    session.appendRoutingTraceEvent({
      type: "attempt_started",
      attemptId: "ignored-after-limit",
      attemptKind: "normal",
      provider: { id: 999 },
      at: 2_000,
    });
    await Promise.resolve();
    expect(liveChainMocks.writeLiveRoutingTrace).toHaveBeenCalledTimes(writesAtLimit);
    await session.closeLiveObservability();

    const trace = session.getRoutingTrace();
    expect(trace?.events).toHaveLength(ROUTING_TRACE_MAX_EVENTS);
    expect(trace?.truncated).toBe(true);
    expect(liveChainMocks.writeLiveRoutingTrace).toHaveBeenCalled();
    expect(liveChainMocks.writeLiveRoutingTrace).toHaveBeenLastCalledWith(
      "routing-trace-session",
      7,
      expect.objectContaining({
        events: expect.arrayContaining([
          expect.objectContaining({ type: "request_started" }),
          expect.objectContaining({ attemptId: "attempt-511" }),
        ]),
        truncated: true,
      })
    );
    expect(liveChainMocks.deleteLiveChain).toHaveBeenCalledWith("routing-trace-session", 7);
  });

  it("coalesces events produced while a live trace write is in flight", async () => {
    let releaseFirstWrite!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    liveChainMocks.writeLiveRoutingTrace
      .mockImplementationOnce(async () => firstWrite)
      .mockResolvedValue(undefined);

    const session = makeTraceSession();
    session.initializeRoutingTrace({
      mode: "discovery",
      discoveryEnabled: true,
      eligible: true,
      startedAt: 1_000,
    });
    await vi.waitFor(() => expect(liveChainMocks.writeLiveRoutingTrace).toHaveBeenCalledTimes(1));

    for (let index = 1; index <= 100; index += 1) {
      session.appendRoutingTraceEvent({
        type: "attempt_started",
        attemptId: `attempt-${index}`,
        attemptKind: "normal",
        provider: { id: index },
        at: 1_000 + index,
      });
    }
    const closePromise = session.closeLiveObservability();
    releaseFirstWrite();
    await closePromise;

    expect(liveChainMocks.writeLiveRoutingTrace).toHaveBeenCalledTimes(2);
    expect(liveChainMocks.writeLiveRoutingTrace).toHaveBeenLastCalledWith(
      "routing-trace-session",
      7,
      expect.objectContaining({
        events: expect.arrayContaining([expect.objectContaining({ attemptId: "attempt-100" })]),
      })
    );
  });

  it("keeps winner metrics request-local and logs only the final retried terminal outcome", async () => {
    const session = makeTraceSession();
    session.initializeRoutingTrace({
      mode: "discovery",
      discoveryEnabled: true,
      eligible: true,
      startedAt: 1_000,
    });
    session.setRoutingTraceSummary({
      outcome: "success",
      statusCode: 200,
      durationMs: 50,
      ttfbMs: 50,
      attemptsPerRequest: 2,
      maxActiveAttempts: 2,
      rounds: 1,
      providerMs: 80,
      fallbackPromotions: 0,
      cancelFailures: 0,
      winnerOrigin: "normal",
      winnerProviderId: 11,
      winnerRound: 1,
    });

    expect(session.getRoutingTrace()?.summary).toBeUndefined();
    session.finalizeRoutingTrace(200, "success");
    session.finalizeRoutingTrace(502, "failed");

    expect(session.getRoutingTrace()?.summary).toMatchObject({
      outcome: "failed",
      statusCode: 502,
    });
    expect(
      session.getRoutingTrace()?.events.filter((event) => event.type === "request_finished")
    ).toEqual([
      expect.objectContaining({ type: "request_finished", outcome: "failed", statusCode: 502 }),
    ]);
    await session.closeLiveObservability();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      "[DiscoveryMetric] Request aggregate",
      expect.objectContaining({
        event: "request_finished",
        outcome: "failed",
        statusCode: 502,
      })
    );
  });
});

describe("routing trace sanitization", () => {
  it("drops request bodies, keys, upstream URLs and raw error payloads", () => {
    const normalized = normalizeRoutingTrace({
      version: 1,
      mode: "discovery",
      startedAt: 1_000,
      updatedAt: 1_010,
      discoveryEnabled: true,
      eligible: true,
      requestBody: { prompt: "secret" },
      apiKey: "sk-secret",
      events: [
        {
          type: "attempt_finished",
          at: 1_010,
          elapsedMs: 10,
          provider: {
            id: 11,
            name: "Provider 11",
            endpointUrl: "https://secret.example.test/v1/messages",
          },
          rawErrorBody: { error: "secret" },
          requestBody: "secret",
          apiKey: "sk-secret",
          outcome: "failed",
          reason: "provider_error",
        },
      ],
    });

    expect(normalized).toEqual({
      version: 1,
      mode: "discovery",
      startedAt: 1_000,
      updatedAt: 1_010,
      discoveryEnabled: true,
      eligible: true,
      events: [
        {
          type: "attempt_finished",
          at: 1_010,
          elapsedMs: 10,
          provider: { id: 11, name: "Provider 11" },
          outcome: "failed",
          reason: "provider_error",
        },
      ],
    });
  });
});
