import { describe, expect, test, vi } from "vitest";
import {
  handleResponsesWebSocketUnsupportedFallback,
  recordResponsesWebSocketDecisionChainObservation,
  type ResponsesWebSocketDecisionChainSession,
} from "@/server/responses-websocket-protocol";
import type { ProviderChainItem } from "@/types/message";
import type { Provider } from "@/types/provider";

type FakeDecisionChainSession = ResponsesWebSocketDecisionChainSession & {
  providerChain: ProviderChainItem[];
};

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 41,
    name: "openai-ws-provider",
    providerType: "openai-compatible",
    providerVendorId: 9,
    url: "https://api.openai.example.com/v1/responses",
    key: "test-upstream-key",
    priority: 10,
    weight: 1,
    costMultiplier: 1,
    groupTag: "ws-test",
    preserveClientIp: false,
    ...overrides,
  } as unknown as Provider;
}

function createSession(): FakeDecisionChainSession {
  const providerChain: ProviderChainItem[] = [];

  return {
    providerChain,
    addProviderToChain(provider, metadata) {
      providerChain.push({
        id: provider.id,
        name: provider.name,
        vendorId: provider.providerVendorId ?? undefined,
        providerType: provider.providerType,
        priority: provider.priority,
        weight: provider.weight,
        costMultiplier: provider.costMultiplier,
        groupTag: provider.groupTag,
        timestamp: Date.now(),
        ...metadata,
      } as ProviderChainItem);
    },
    getProviderChain() {
      return providerChain;
    },
  };
}

function firstChainEntry(session: FakeDecisionChainSession): Record<string, unknown> {
  const [entry] = session.getProviderChain();
  expect(entry).toBeDefined();
  return entry as Record<string, unknown>;
}

describe("Responses WebSocket decision-chain observability contract", () => {
  test("records successful upstream WebSocket metadata on the final provider chain item", () => {
    const session = createSession();
    const provider = createProvider();

    const entry = recordResponsesWebSocketDecisionChainObservation({
      session,
      provider,
      statusCode: 101,
      metadata: {
        clientTransport: "websocket",
        upstreamWsAttempted: true,
        upstreamWsConnected: true,
        downgradedToHttp: false,
      },
    });

    expect(entry).toMatchObject({
      id: provider.id,
      name: provider.name,
      providerType: "openai-compatible",
      statusCode: 101,
      clientTransport: "websocket",
      upstreamWsAttempted: true,
      upstreamWsConnected: true,
      downgradedToHttp: false,
    });
    expect(firstChainEntry(session)).toMatchObject(entry);
  });

  test("records fallback metadata with a concrete downgrade reason", () => {
    const session = createSession();
    const provider = createProvider();

    recordResponsesWebSocketDecisionChainObservation({
      session,
      provider,
      statusCode: 200,
      metadata: {
        clientTransport: "websocket",
        upstreamWsAttempted: true,
        upstreamWsConnected: false,
        downgradedToHttp: true,
        downgradeReason: "upstream_ws_unsupported",
      },
    });

    expect(firstChainEntry(session)).toMatchObject({
      id: provider.id,
      statusCode: 200,
      clientTransport: "websocket",
      upstreamWsAttempted: true,
      upstreamWsConnected: false,
      downgradedToHttp: true,
      downgradeReason: "upstream_ws_unsupported",
    });
  });

  test("records queue wait metadata for a queued second WebSocket request", () => {
    const session = createSession();
    const provider = createProvider();

    recordResponsesWebSocketDecisionChainObservation({
      session,
      provider,
      statusCode: 101,
      metadata: {
        clientTransport: "websocket",
        upstreamWsAttempted: true,
        upstreamWsConnected: true,
        downgradedToHttp: false,
        queueWaitMs: 37,
      },
    });

    expect(firstChainEntry(session)).toMatchObject({
      clientTransport: "websocket",
      upstreamWsAttempted: true,
      upstreamWsConnected: true,
      downgradedToHttp: false,
      queueWaitMs: 37,
    });
  });

  test("records store=false cache metadata without raw request content", () => {
    const session = createSession();
    const provider = createProvider();

    recordResponsesWebSocketDecisionChainObservation({
      session,
      provider,
      statusCode: 200,
      metadata: {
        clientTransport: "websocket",
        upstreamWsAttempted: false,
        upstreamWsConnected: false,
        downgradedToHttp: false,
        storeFalseCacheHit: true,
      },
    });

    const entry = firstChainEntry(session);
    expect(entry).toMatchObject({
      clientTransport: "websocket",
      upstreamWsAttempted: false,
      upstreamWsConnected: false,
      downgradedToHttp: false,
      storeFalseCacheHit: true,
    });
    expect(entry).not.toHaveProperty("rawMessage");
    expect(entry).not.toHaveProperty("input");
    expect(entry).not.toHaveProperty("messages");
  });

  test("does not count WebSocket unsupported fallback as circuit-breaker failure", async () => {
    const recorders = {
      recordFailure: vi.fn(async () => {}),
      recordEndpointFailure: vi.fn(async () => {}),
      recordVendorTypeAllEndpointsTimeout: vi.fn(async () => {}),
    };

    await handleResponsesWebSocketUnsupportedFallback({
      providerId: 41,
      endpointId: 501,
      vendorId: 9,
      providerType: "openai-compatible",
      downgradeReason: "upstream_ws_unsupported",
      recorders,
    });

    expect(recorders.recordFailure).not.toHaveBeenCalled();
    expect(recorders.recordEndpointFailure).not.toHaveBeenCalled();
    expect(recorders.recordVendorTypeAllEndpointsTimeout).not.toHaveBeenCalled();
  });
});
