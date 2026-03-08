/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestResultCard } from "@/app/[locale]/settings/providers/_components/forms/test-result-card";

vi.mock("next-intl", () => ({
  useTimeZone: () => "UTC",
  useTranslations: () => (key: string) => {
    const map: Record<string, string> = {
      "resultCard.status.green": "Available",
      "resultCard.status.yellow": "Degraded",
      "resultCard.status.red": "Unavailable",
      "resultCard.labels.http": "HTTP",
      "resultCard.labels.latency": "Latency",
      "resultCard.labels.content": "Content",
      "resultCard.labels.model": "Model",
      "resultCard.labels.firstByte": "First Byte",
      "resultCard.labels.totalLatency": "Total Latency",
      "resultCard.labels.transport": "Transport",
      "resultCard.labels.websocketHandshake": "WS Handshake",
      "resultCard.labels.websocketEvents": "WS Events",
      "resultCard.labels.websocketFallbackReason": "WS Fallback",
      "resultCard.labels.responsePreview": "Response Preview",
      "resultCard.labels.error": "Error",
      "resultCard.timing.title": "Timing Info",
      "resultCard.timing.totalLatency": "Total Latency",
      "resultCard.timing.firstByte": "First Byte",
      "resultCard.timing.testedAt": "Tested At",
      "resultCard.tokenUsage.title": "Token Usage",
      "resultCard.tokenUsage.input": "Input",
      "resultCard.tokenUsage.output": "Output",
      "resultCard.rawResponse.title": "Raw Response Body",
      "resultCard.rawResponse.hint": "Hint",
      "resultCard.transportKind.http": "HTTP",
      "resultCard.transportKind.responses_websocket": "Responses WebSocket",
      viewDetails: "View Details",
      copySuccess: "Copied",
      copyFailed: "Copy failed",
    };
    return map[key] ?? key;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("provider test websocket UI", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders websocket transport metadata in the existing result card", () => {
    const { container, unmount } = render(
      <TestResultCard
        result={{
          success: true,
          status: "green",
          subStatus: "success",
          message: "Provider available",
          latencyMs: 120,
          firstByteMs: 12,
          model: "gpt-5-codex",
          transportKind: "responses_websocket",
          websocketHandshakeMs: 8,
          websocketEventCount: 3,
          testedAt: "2026-03-08T00:00:00.000Z",
          validationDetails: {
            httpPassed: true,
            latencyPassed: true,
            contentPassed: true,
            contentTarget: "pong",
          },
        }}
      />
    );

    const text = container.textContent || "";
    expect(text).toContain("Responses WebSocket");
    expect(text).toContain("WS Handshake");
    expect(text).toContain("8ms");
    expect(text).toContain("WS Events");
    expect(text).toContain("3");

    unmount();
  });

  it("shows fallback reason without claiming websocket success", () => {
    const { container, unmount } = render(
      <TestResultCard
        result={{
          success: true,
          status: "yellow",
          subStatus: "slow_latency",
          message: "Provider available via fallback",
          latencyMs: 250,
          model: "gpt-5-codex",
          transportKind: "http",
          websocketFallbackReason: "proxy_incompatible",
          testedAt: "2026-03-08T00:00:00.000Z",
          validationDetails: {
            httpPassed: true,
            latencyPassed: true,
            contentPassed: true,
            contentTarget: "pong",
          },
        }}
      />
    );

    const text = container.textContent || "";
    expect(text).toContain("HTTP");
    expect(text).toContain("WS Fallback");
    expect(text).toContain("proxy_incompatible");
    expect(text).not.toContain("Responses WebSocketWS Handshake");

    unmount();
  });
});
