import { describe, expect, it } from "vitest";
import {
  classifyResponsesWsFallback,
  evaluateResponsesWsTransport,
} from "@/app/v1/_lib/proxy/responses-ws-transport";

describe("responses websocket transport selector", () => {
  it("falls back to HTTP without breaker penalty", () => {
    const decision = evaluateResponsesWsTransport({
      enableResponsesWebSocket: true,
      provider: {
        id: 1,
        name: "Codex Proxy",
        providerType: "codex",
        proxyUrl: "http://proxy.internal:8080",
      },
      upstreamUrl: "https://api.openai.com/v1/responses",
    });

    const fallback = classifyResponsesWsFallback({
      failure: "proxy_incompatible",
      upstreamRequestEstablished: false,
    });

    expect(decision.effectiveTransport).toBe("http");
    expect(decision.fallbackReason).toBe("proxy_incompatible");
    expect(decision.specialSetting.fallbackReason).toBe("proxy_incompatible");
    expect(fallback.allowHttpFallback).toBe(true);
    expect(fallback.countsTowardCircuitBreaker).toBe(false);
    expect(fallback.providerChainReason).toBe("responses_websocket_fallback");
  });

  it("does not fallback on upstream auth error", () => {
    const decision = evaluateResponsesWsTransport({
      enableResponsesWebSocket: true,
      provider: {
        id: 1,
        name: "Codex Proxy",
        providerType: "codex",
        proxyUrl: null,
      },
      upstreamUrl: "https://api.openai.com/v1/responses",
    });

    const fallback = classifyResponsesWsFallback({
      failure: "upstream_http_4xx",
      upstreamRequestEstablished: true,
    });

    expect(decision.effectiveTransport).toBe("responses_websocket");
    expect(decision.websocketUrl).toBe("wss://api.openai.com/v1/responses");
    expect(fallback.allowHttpFallback).toBe(false);
    expect(fallback.providerChainReason).toBeNull();
  });
});
