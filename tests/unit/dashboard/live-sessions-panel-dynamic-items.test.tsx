/**
 * @vitest-environment happy-dom
 */

import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LiveSessionsPanel } from "@/app/[locale]/dashboard/_components/bento/live-sessions-panel";
import type { ActiveSessionInfo } from "@/types/session";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

const customsMessages = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "messages/en/customs.json"), "utf8")
);

const SESSION_ITEM_HEIGHT = 36;
const HEADER_HEIGHT = 48;
const FOOTER_HEIGHT = 36;

function createMockSession(id: number): ActiveSessionInfo & { lastActivityAt?: number } {
  return {
    sessionId: `session_${id}`,
    userName: `User ${id}`,
    keyName: `key_${id}`,
    model: "claude-sonnet-4-5-20250929",
    providerName: "anthropic",
    status: "in_progress",
    startTime: Date.now() - 1000,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.01,
    lastActivityAt: Date.now(),
  };
}

function renderWithIntl(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={{ customs: customsMessages }} timeZone="UTC">
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

describe("LiveSessionsPanel - dynamic maxItems calculation", () => {
  let resizeCallback: ResizeObserverCallback | null = null;
  let observedElement: Element | null = null;

  beforeEach(() => {
    resizeCallback = null;
    observedElement = null;

    vi.stubGlobal(
      "ResizeObserver",
      class MockResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe(element: Element) {
          observedElement = element;
        }
        unobserve() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("should calculate maxItems based on container height when maxItems prop is not provided", () => {
    const sessions = Array.from({ length: 20 }, (_, i) => createMockSession(i + 1));

    const { container, unmount } = renderWithIntl(
      <LiveSessionsPanel sessions={sessions} isLoading={false} />
    );

    const bentoCard = container.querySelector("[class*='flex-col']");
    expect(bentoCard).toBeTruthy();

    // Simulate container height that can fit 5 items
    // Available height = containerHeight - HEADER_HEIGHT - FOOTER_HEIGHT
    // Items = floor(availableHeight / SESSION_ITEM_HEIGHT)
    // For 5 items: availableHeight = 5 * 36 = 180, containerHeight = 180 + 48 + 36 = 264
    const containerHeight = 264;

    if (observedElement && resizeCallback) {
      Object.defineProperty(observedElement, "clientHeight", {
        value: containerHeight,
        configurable: true,
      });

      act(() => {
        resizeCallback!([{ target: observedElement } as ResizeObserverEntry], {} as ResizeObserver);
      });
    }

    // Count rendered session items (buttons with session info)
    const sessionButtons = container.querySelectorAll("button[class*='flex items-center gap-3']");
    expect(sessionButtons.length).toBe(5);

    unmount();
  });

  test("should show all sessions when container is large enough", () => {
    const sessions = Array.from({ length: 3 }, (_, i) => createMockSession(i + 1));

    const { container, unmount } = renderWithIntl(
      <LiveSessionsPanel sessions={sessions} isLoading={false} />
    );

    // Container height for 10 items (more than we have)
    const containerHeight = 10 * SESSION_ITEM_HEIGHT + HEADER_HEIGHT + FOOTER_HEIGHT;

    if (observedElement && resizeCallback) {
      Object.defineProperty(observedElement, "clientHeight", {
        value: containerHeight,
        configurable: true,
      });

      act(() => {
        resizeCallback!([{ target: observedElement } as ResizeObserverEntry], {} as ResizeObserver);
      });
    }

    const sessionButtons = container.querySelectorAll("button[class*='flex items-center gap-3']");
    expect(sessionButtons.length).toBe(3);

    unmount();
  });

  test("should update displayed items when container resizes", () => {
    const sessions = Array.from({ length: 15 }, (_, i) => createMockSession(i + 1));

    const { container, unmount } = renderWithIntl(
      <LiveSessionsPanel sessions={sessions} isLoading={false} />
    );

    // Initial: container fits 4 items
    let containerHeight = 4 * SESSION_ITEM_HEIGHT + HEADER_HEIGHT + FOOTER_HEIGHT;

    if (observedElement && resizeCallback) {
      Object.defineProperty(observedElement, "clientHeight", {
        value: containerHeight,
        configurable: true,
      });

      act(() => {
        resizeCallback!([{ target: observedElement } as ResizeObserverEntry], {} as ResizeObserver);
      });
    }

    let sessionButtons = container.querySelectorAll("button[class*='flex items-center gap-3']");
    expect(sessionButtons.length).toBe(4);

    // Resize: container now fits 8 items
    containerHeight = 8 * SESSION_ITEM_HEIGHT + HEADER_HEIGHT + FOOTER_HEIGHT;

    if (observedElement && resizeCallback) {
      Object.defineProperty(observedElement, "clientHeight", {
        value: containerHeight,
        configurable: true,
      });

      act(() => {
        resizeCallback!([{ target: observedElement } as ResizeObserverEntry], {} as ResizeObserver);
      });
    }

    sessionButtons = container.querySelectorAll("button[class*='flex items-center gap-3']");
    expect(sessionButtons.length).toBe(8);

    unmount();
  });

  test("should respect maxItems prop as upper limit when provided", () => {
    const sessions = Array.from({ length: 20 }, (_, i) => createMockSession(i + 1));

    const { container, unmount } = renderWithIntl(
      <LiveSessionsPanel sessions={sessions} isLoading={false} maxItems={5} />
    );

    // Container can fit 10 items, but maxItems is 5
    const containerHeight = 10 * SESSION_ITEM_HEIGHT + HEADER_HEIGHT + FOOTER_HEIGHT;

    if (observedElement && resizeCallback) {
      Object.defineProperty(observedElement, "clientHeight", {
        value: containerHeight,
        configurable: true,
      });

      act(() => {
        resizeCallback!([{ target: observedElement } as ResizeObserverEntry], {} as ResizeObserver);
      });
    }

    const sessionButtons = container.querySelectorAll("button[class*='flex items-center gap-3']");
    expect(sessionButtons.length).toBe(5);

    unmount();
  });

  test("should show View All button with correct count", () => {
    const sessions = Array.from({ length: 12 }, (_, i) => createMockSession(i + 1));

    const { container, unmount } = renderWithIntl(
      <LiveSessionsPanel sessions={sessions} isLoading={false} />
    );

    // Container fits 6 items
    const containerHeight = 6 * SESSION_ITEM_HEIGHT + HEADER_HEIGHT + FOOTER_HEIGHT;

    if (observedElement && resizeCallback) {
      Object.defineProperty(observedElement, "clientHeight", {
        value: containerHeight,
        configurable: true,
      });

      act(() => {
        resizeCallback!([{ target: observedElement } as ResizeObserverEntry], {} as ResizeObserver);
      });
    }

    // Footer should show total count
    expect(container.textContent).toContain("View All");
    expect(container.textContent).toContain("(12)");

    unmount();
  });
});
