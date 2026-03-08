/**
 * @vitest-environment happy-dom
 */

import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";
import { WsTestStatus } from "@/app/[locale]/settings/providers/_components/forms/ws-test-status";
import type { WsTestResultFields } from "@/lib/provider-testing/ws-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOCALES = ["en", "zh-CN", "zh-TW", "ja", "ru"] as const;
const WS_KEYS = [
  "status",
  "supported",
  "unsupported",
  "fallback",
  "handshakeMs",
  "eventCount",
  "fallbackReason",
] as const;

function loadApiTestMessages(locale: string): Record<string, unknown> {
  const filePath = path.join(
    process.cwd(),
    "messages",
    locale,
    "settings/providers/form/apiTest.json"
  );
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function renderWithIntl(node: ReactNode, messages?: Record<string, unknown>) {
  const msgs = messages ?? loadApiTestMessages("en");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <NextIntlClientProvider
        locale="en"
        messages={{ settings: { providers: { form: { apiTest: msgs } } } }}
        timeZone="UTC"
      >
        {node}
      </NextIntlClientProvider>
    );
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Component rendering tests
// ---------------------------------------------------------------------------

describe("WsTestStatus", () => {
  test('renders "Supported" badge when wsSupported=true, wsTransport="websocket"', () => {
    const result: WsTestResultFields = {
      wsSupported: true,
      wsTransport: "websocket",
      wsHandshakeMs: 120,
      wsEventCount: 8,
    };

    const { container, unmount } = renderWithIntl(<WsTestStatus result={result} />);

    const root = container.querySelector('[data-testid="ws-test-status"]');
    expect(root).not.toBeNull();

    const badge = container.querySelector('[data-testid="ws-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("Supported");

    unmount();
  });

  test('renders "Unsupported" badge when wsTransport="unsupported"', () => {
    const result: WsTestResultFields = {
      wsSupported: false,
      wsTransport: "unsupported",
      wsFallbackReason: "Connection refused",
    };

    const { container, unmount } = renderWithIntl(<WsTestStatus result={result} />);

    const badge = container.querySelector('[data-testid="ws-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("Unsupported");

    unmount();
  });

  test('renders "HTTP Fallback" badge when wsTransport="http_fallback"', () => {
    const result: WsTestResultFields = {
      wsSupported: false,
      wsTransport: "http_fallback",
      wsFallbackReason: "Provider does not support WS",
    };

    const { container, unmount } = renderWithIntl(<WsTestStatus result={result} />);

    const badge = container.querySelector('[data-testid="ws-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("HTTP Fallback");

    unmount();
  });

  test("shows handshake latency when wsHandshakeMs is provided", () => {
    const result: WsTestResultFields = {
      wsSupported: true,
      wsTransport: "websocket",
      wsHandshakeMs: 250,
    };

    const { container, unmount } = renderWithIntl(<WsTestStatus result={result} />);

    const handshake = container.querySelector('[data-testid="ws-handshake"]');
    expect(handshake).not.toBeNull();
    expect(handshake!.textContent).toContain("250ms");

    unmount();
  });

  test("shows event count when wsEventCount is provided", () => {
    const result: WsTestResultFields = {
      wsSupported: true,
      wsTransport: "websocket",
      wsEventCount: 12,
    };

    const { container, unmount } = renderWithIntl(<WsTestStatus result={result} />);

    const eventCount = container.querySelector('[data-testid="ws-event-count"]');
    expect(eventCount).not.toBeNull();
    expect(eventCount!.textContent).toContain("12");

    unmount();
  });

  test("shows fallback reason when wsFallbackReason is provided", () => {
    const result: WsTestResultFields = {
      wsSupported: false,
      wsTransport: "unsupported",
      wsFallbackReason: "Connection refused",
    };

    const { container, unmount } = renderWithIntl(<WsTestStatus result={result} />);

    const reason = container.querySelector('[data-testid="ws-fallback-reason"]');
    expect(reason).not.toBeNull();
    expect(reason!.textContent).toContain("Connection refused");

    unmount();
  });

  test("renders nothing when no WS fields are provided", () => {
    const result: WsTestResultFields = {};

    const { container, unmount } = renderWithIntl(<WsTestStatus result={result} />);

    const root = container.querySelector('[data-testid="ws-test-status"]');
    expect(root).toBeNull();

    unmount();
  });
});

// ---------------------------------------------------------------------------
// i18n key presence test
// ---------------------------------------------------------------------------

describe("WsTestStatus i18n keys", () => {
  test("all required ws.* keys exist in all 5 locale files", () => {
    for (const locale of LOCALES) {
      const messages = loadApiTestMessages(locale);
      const ws = messages.ws as Record<string, string> | undefined;

      expect(ws, `messages/${locale} is missing the "ws" section`).toBeDefined();

      for (const key of WS_KEYS) {
        expect(ws![key], `messages/${locale}/apiTest.json is missing ws.${key}`).toBeDefined();
        expect(
          typeof ws![key],
          `messages/${locale}/apiTest.json ws.${key} should be a string`
        ).toBe("string");
        expect(
          (ws![key] as string).length,
          `messages/${locale}/apiTest.json ws.${key} should not be empty`
        ).toBeGreaterThan(0);
      }
    }
  });
});
