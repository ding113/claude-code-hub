/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicStatusView } from "@/app/[locale]/status/_components/public-status-view";
import type { PublicStatusPayload } from "@/lib/public-status/payload";
import type { PublicStatusRouteResponse } from "@/lib/public-status/public-api-contract";

vi.mock("@/app/[locale]/status/status-page.css", () => ({}));

vi.mock("@/components/ui/theme-switcher", () => ({
  ThemeSwitcher: () => <div data-testid="theme-switcher" />,
}));

vi.mock("@/lib/public-status/vendor-icon", () => ({
  getPublicStatusVendorIconComponent: ({
    modelName,
    vendorIconKey,
  }: {
    modelName: string;
    vendorIconKey: string;
  }) => ({
    Icon: ({ className }: { className?: string }) => (
      <span
        className={className}
        data-vendor-icon-key={
          vendorIconKey === "generic" && modelName.startsWith("qwen") ? "qwen" : vendorIconKey
        }
      />
    ),
  }),
}));

vi.mock("@/app/[locale]/status/_components/public-status-timeline", () => ({
  PublicStatusTimeline: ({ cells }: { cells: unknown[] }) => (
    <div data-testid="public-status-timeline">{cells.length}</div>
  ),
}));

vi.mock("@/app/[locale]/status/_components/status-hero", () => ({
  StatusHero: ({
    siteTitle,
    statusLabel,
    generatedAtLabel,
    generatedAt,
  }: {
    siteTitle: string;
    statusLabel: string;
    generatedAtLabel: string;
    generatedAt: string | null;
  }) => (
    <div>
      <h1>{siteTitle}</h1>
      <div>{statusLabel}</div>
      {generatedAt ? <span>{generatedAtLabel}</span> : null}
    </div>
  ),
}));

vi.mock("@/app/[locale]/status/_components/status-toolbar", () => ({
  StatusToolbar: () => <div data-testid="status-toolbar" />,
}));

vi.mock("@/app/[locale]/status/_components/sortable-group-panel", () => ({
  SortableGroupPanel: ({ children }: { children: ReactNode }) => (
    <div data-testid="sortable-group-panel">{children}</div>
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

function buildRouteResponse(
  payloadOverrides: Partial<PublicStatusPayload> = {}
): PublicStatusRouteResponse {
  const payload = buildPayload(payloadOverrides);
  const status =
    payload.rebuildState === "fresh"
      ? "ready"
      : payload.rebuildState === "stale"
        ? "stale"
        : payload.rebuildState === "no-data"
          ? "no_data"
          : payload.generatedAt
            ? "stale"
            : "no_snapshot";

  return {
    generatedAt: payload.generatedAt,
    freshUntil: payload.freshUntil,
    status,
    rebuildState: {
      state: payload.rebuildState,
      hasSnapshot: Boolean(payload.generatedAt),
      reason: null,
    },
    defaults: {
      intervalMinutes: 5,
      rangeHours: 24,
    },
    resolvedQuery: {
      intervalMinutes: 5,
      rangeHours: 24,
      groupSlugs: [],
      models: [],
      statuses: [],
      q: null,
      include: ["meta", "defaults", "groups", "timeline"],
    },
    meta: {
      siteTitle: "Acme AI Hub",
      siteDescription: "Acme AI Hub public status",
      timeZone: "UTC",
    },
    groups: payload.groups,
  };
}

function buildLabels() {
  return {
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
    noSnapshot: "No snapshot yet",
    noData: "No data",
    emptyDescription: "Preparing first snapshot",
    requestTypes: {
      openaiCompatible: "OpenAI Compatible",
      codex: "Codex",
      anthropic: "Anthropic",
      gemini: "Gemini",
    },
    statusBadge: {
      operational: "Operational",
      degraded: "Degraded",
      failed: "Failed",
      noData: "No data",
    },
    tooltip: {
      availability: "Availability tooltip",
      ttfb: "TTFB tooltip",
      tps: "TPS tooltip",
      historyAriaLabel: "History aria",
    },
    searchPlaceholder: "Search",
    customSort: "Custom sort",
    resetSort: "Reset sort",
    emptyByFilter: "No results",
    modelsLabel: "Models",
    issuesLabel: "Issues",
    clearSearch: "Clear",
    dragHandle: "Drag",
    toggleGroup: "Toggle",
    openGroupPage: "Open group page",
  };
}

describe("public-status view", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      status: 200,
      json: async () => buildRouteResponse(),
    })) as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("shows the resolved site title and removes history/freshness rows from the hero", () => {
    const { container, unmount } = render(
      <PublicStatusView
        initialPayload={buildPayload()}
        initialStatus="ready"
        intervalMinutes={5}
        rangeHours={24}
        locale="en"
        timeZone="UTC"
        labels={buildLabels()}
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
        initialStatus="no_snapshot"
        intervalMinutes={5}
        rangeHours={24}
        locale="en"
        timeZone="UTC"
        labels={buildLabels()}
        siteTitle="Acme AI Hub"
      />
    );

    expect(container.textContent).toContain("No snapshot yet");
    expect(container.textContent).toContain("Preparing first snapshot");

    unmount();
  });

  it("uses the correct fetch URL and keeps stale/no-data semantics visible", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () =>
        buildRouteResponse({
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
        initialStatus="no_snapshot"
        intervalMinutes={5}
        rangeHours={24}
        locale="en"
        timeZone="UTC"
        labels={buildLabels()}
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

  it("falls back to shared model-prefix vendor icons when payload vendorIconKey is generic", () => {
    const { container, unmount } = render(
      <PublicStatusView
        initialPayload={buildPayload({
          groups: [
            {
              publicGroupSlug: "mixed",
              displayName: "Mixed",
              explanatoryCopy: "Prefix-matched icons",
              models: [
                {
                  publicModelKey: "qwen-max",
                  label: "Qwen Max",
                  vendorIconKey: "generic",
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
        })}
        initialStatus="ready"
        intervalMinutes={5}
        rangeHours={24}
        locale="en"
        timeZone="UTC"
        labels={buildLabels()}
        siteTitle="Acme AI Hub"
      />
    );

    expect(container.querySelector('[data-vendor-icon-key="qwen"]')).not.toBeNull();

    unmount();
  });

  it("keeps explicit vendorIconKey when the model prefix itself is ambiguous", () => {
    const { container, unmount } = render(
      <PublicStatusView
        initialPayload={buildPayload({
          groups: [
            {
              publicGroupSlug: "mixed",
              displayName: "Mixed",
              explanatoryCopy: "Override icon",
              models: [
                {
                  publicModelKey: "reasoner-pro",
                  label: "Reasoner Pro",
                  vendorIconKey: "gemini",
                  requestTypeBadge: "gemini",
                  latestState: "operational",
                  availabilityPct: 99.9,
                  latestTtfbMs: 420,
                  latestTps: null,
                  timeline: [],
                },
              ],
            },
          ],
        })}
        initialStatus="ready"
        intervalMinutes={5}
        rangeHours={24}
        locale="en"
        timeZone="UTC"
        labels={buildLabels()}
        siteTitle="Acme AI Hub"
      />
    );

    expect(container.querySelector('[data-vendor-icon-key="gemini"]')).not.toBeNull();

    unmount();
  });

  it("keeps filterSlug-scoped default group after polling refresh", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () =>
        buildRouteResponse({
          groups: [
            {
              publicGroupSlug: "platform",
              displayName: "Platform",
              explanatoryCopy: "Default group",
              models: [
                {
                  publicModelKey: "platform-model",
                  label: "Platform Model",
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
            {
              publicGroupSlug: "openai",
              displayName: "OpenAI",
              explanatoryCopy: "Named group",
              models: [
                {
                  publicModelKey: "openai-model",
                  label: "OpenAI Model",
                  vendorIconKey: "openai",
                  requestTypeBadge: "openaiCompatible",
                  latestState: "failed",
                  availabilityPct: 50,
                  latestTtfbMs: 700,
                  latestTps: null,
                  timeline: [],
                },
              ],
            },
          ],
        }),
    }));
    global.fetch = fetchMock as typeof global.fetch;

    const { container, unmount } = render(
      <PublicStatusView
        initialPayload={buildPayload({
          groups: [
            {
              publicGroupSlug: "platform",
              displayName: "Platform",
              explanatoryCopy: "Default group",
              models: [
                {
                  publicModelKey: "platform-model",
                  label: "Platform Model",
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
        })}
        initialStatus="ready"
        intervalMinutes={5}
        rangeHours={24}
        followServerDefaults={true}
        filterSlug="platform"
        locale="en"
        timeZone="UTC"
        labels={buildLabels()}
        siteTitle="Acme AI Hub"
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/public-status?groupSlug=platform", {
      cache: "no-store",
    });

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    const text = container.textContent || "";
    expect(text).toContain("Platform Model");
    expect(text).not.toContain("OpenAI Model");
    expect(container.querySelectorAll('[data-testid="sortable-group-panel"]')).toHaveLength(1);

    vi.useRealTimers();
    unmount();
  });
});
