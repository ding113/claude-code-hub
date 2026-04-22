/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicStatusView } from "@/app/[locale]/status/_components/public-status-view";
import type { PublicStatusPayload } from "@/lib/public-status/payload";

vi.mock("@/components/ui/theme-switcher", () => ({
  ThemeSwitcher: () => <div data-testid="theme-switcher" />,
}));

vi.mock("@/app/[locale]/status/_components/public-status-timeline", () => ({
  PublicStatusTimeline: ({ items }: { items: unknown[] }) => (
    <div data-testid="public-status-timeline">{items.length}</div>
  ),
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

function buildPayload(overrides: Partial<PublicStatusPayload> = {}): PublicStatusPayload {
  return {
    rebuildState: "fresh",
    sourceGeneration: "gen-1",
    generatedAt: "2026-04-22T00:00:00.000Z",
    freshUntil: "2026-04-22T00:05:00.000Z",
    groups: [
      {
        publicGroupSlug: "openai",
        displayName: "OpenAI",
        explanatoryCopy: "Primary models",
        models: [
          {
            publicModelKey: "gpt-4.1",
            label: "GPT-4.1",
            vendorIconKey: "openai",
            requestTypeBadge: "openaiCompatible",
            latestState: "operational",
            availabilityPct: 99.9,
            latestTtfbMs: 420,
            latestTps: null,
            timeline: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("public-status view", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => buildPayload(),
    })) as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("shows the resolved site title and removes history/freshness rows from the hero", () => {
    const { container, unmount } = render(
      <PublicStatusView
        initialPayload={buildPayload()}
        intervalMinutes={5}
        rangeHours={24}
        locale="en"
        timeZone="UTC"
        labels={{
          systemStatus: "System Status",
          heroPrimary: "AI SERVICES",
          heroSecondary: "INTELLIGENCE MONITOR",
          generatedAt: "Updated",
          history: "History",
          availability: "Availability",
          ttfb: "TTFB",
          freshnessWindow: "Snapshot freshness",
          fresh: "Fresh",
          stale: "Stale",
          rebuilding: "Rebuilding",
          noData: "No data",
          emptyDescription: "Preparing first snapshot",
          requestTypes: {
            openaiCompatible: "OpenAI Compatible",
            codex: "Codex",
            anthropic: "Anthropic",
            gemini: "Gemini",
          },
        }}
        siteTitle="Acme AI Hub"
      />
    );

    const heroTitle = container.querySelector("h1")?.textContent?.trim();
    expect(heroTitle).toBe("Acme AI Hub");
    expect(container.textContent).not.toContain("History");
    expect(container.textContent).not.toContain("Snapshot freshness");

    unmount();
  });

  it("keeps rebuild messaging when there is no public snapshot yet", () => {
    const { container, unmount } = render(
      <PublicStatusView
        initialPayload={buildPayload({
          rebuildState: "rebuilding",
          generatedAt: null,
          freshUntil: null,
          groups: [],
        })}
        intervalMinutes={5}
        rangeHours={24}
        locale="en"
        timeZone="UTC"
        labels={{
          systemStatus: "System Status",
          heroPrimary: "AI SERVICES",
          heroSecondary: "INTELLIGENCE MONITOR",
          generatedAt: "Updated",
          history: "History",
          availability: "Availability",
          ttfb: "TTFB",
          freshnessWindow: "Snapshot freshness",
          fresh: "Fresh",
          stale: "Stale",
          rebuilding: "Rebuilding",
          noData: "No data",
          emptyDescription: "Preparing first snapshot",
          requestTypes: {
            openaiCompatible: "OpenAI Compatible",
            codex: "Codex",
            anthropic: "Anthropic",
            gemini: "Gemini",
          },
        }}
        siteTitle="Acme AI Hub"
      />
    );

    expect(container.textContent).toContain("Rebuilding");
    expect(container.textContent).toContain("Preparing first snapshot");

    unmount();
  });

  it("uses the correct fetch URL and keeps stale/no-data semantics visible", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () =>
        buildPayload({
          rebuildState: "stale",
          groups: [],
        }),
    }));
    global.fetch = fetchMock as typeof global.fetch;

    const { container, unmount } = render(
      <PublicStatusView
        initialPayload={buildPayload({
          rebuildState: "rebuilding",
          groups: [],
        })}
        intervalMinutes={5}
        rangeHours={24}
        locale="en"
        timeZone="UTC"
        labels={{
          systemStatus: "System Status",
          heroPrimary: "AI SERVICES",
          heroSecondary: "INTELLIGENCE MONITOR",
          generatedAt: "Updated",
          history: "History",
          availability: "Availability",
          ttfb: "TTFB",
          freshnessWindow: "Snapshot freshness",
          fresh: "Fresh",
          stale: "Stale",
          staleDetail: "Refresh delayed",
          rebuilding: "Rebuilding",
          noData: "No data",
          emptyDescription: "Preparing first snapshot",
          requestTypes: {
            openaiCompatible: "OpenAI Compatible",
            codex: "Codex",
            anthropic: "Anthropic",
            gemini: "Gemini",
          },
        }}
        siteTitle="Acme AI Hub"
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/public-status?interval=5&rangeHours=24", {
      cache: "no-store",
    });

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Refresh delayed");
    expect(container.textContent).toContain("Preparing first snapshot");

    vi.useRealTimers();
    unmount();
  });
});
