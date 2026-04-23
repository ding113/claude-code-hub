import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetTranslations = vi.hoisted(() => vi.fn());
const mockLoadPublicStatusPageData = vi.hoisted(() => vi.fn());
const mockPublicStatusView = vi.hoisted(() => vi.fn(() => null));

vi.mock("next-intl/server", () => ({
  getTranslations: mockGetTranslations,
}));

vi.mock("@/lib/public-status/public-api-loader", () => ({
  loadPublicStatusPageData: mockLoadPublicStatusPageData,
}));

vi.mock("@/app/[locale]/status/_components/public-status-view", () => ({
  PublicStatusView: mockPublicStatusView,
}));

describe("PublicStatusPage locale handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockGetTranslations.mockImplementation(async (input?: unknown) => {
      if (
        input &&
        typeof input === "object" &&
        "locale" in input &&
        input.locale === "en" &&
        "namespace" in input &&
        input.namespace === "settings.statusPage.public"
      ) {
        return (key: string) => {
          const entries: Record<string, string> = {
            systemStatus: "System Status",
            heroPrimary: "AI SERVICES",
            heroSecondary: "Public API status overview.",
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
            modelsLabel: "Models",
            issuesLabel: "Issues",
            clearSearch: "Clear",
            dragHandle: "Drag",
            toggleGroup: "Toggle",
            openGroupPage: "Open group page",
            customSort: "Custom sort",
            resetSort: "Reset sort",
            searchPlaceholder: "Search",
            emptyByFilter: "No results",
            "requestTypes.openaiCompatible": "OpenAI Compatible",
            "requestTypes.codex": "Codex",
            "requestTypes.anthropic": "Anthropic",
            "requestTypes.gemini": "Gemini",
            "statusBadge.operational": "Operational",
            "statusBadge.degraded": "Degraded",
            "statusBadge.failed": "Failed",
            "statusBadge.noData": "No data",
            "tooltip.availability": "Availability tooltip",
            "tooltip.ttfb": "TTFB tooltip",
            "tooltip.tps": "TPS tooltip",
            "tooltip.historyAriaLabel": "History aria",
          };

          return entries[key] ?? key;
        };
      }

      return (key: string) => `zh:${key}`;
    });

    mockLoadPublicStatusPageData.mockResolvedValue({
      initialPayload: {
        rebuildState: "fresh",
        sourceGeneration: "",
        generatedAt: "2026-04-22T10:00:00.000Z",
        freshUntil: "2026-04-22T10:05:00.000Z",
        groups: [],
      },
      status: "ready",
      intervalMinutes: 5,
      rangeHours: 24,
      followServerDefaults: true,
      siteTitle: "Claude Code Hub",
      timeZone: "UTC",
      meta: {
        siteTitle: "Claude Code Hub",
        siteDescription: "Claude Code Hub public status",
        timeZone: "UTC",
      },
      response: {} as never,
    });
  });

  it("passes the route locale into public status translations", async () => {
    const mod = await import("@/app/[locale]/status/page");

    const element = await mod.default({
      params: Promise.resolve({ locale: "en" }),
    });

    expect(mockGetTranslations).toHaveBeenCalledWith({
      locale: "en",
      namespace: "settings.statusPage.public",
    });
    expect(
      (
        element as {
          props: {
            locale: string;
            labels: { heroPrimary: string; heroSecondary: string; fresh: string };
          };
        }
      ).props
    ).toMatchObject({
      locale: "en",
      labels: {
        heroPrimary: "AI SERVICES",
        heroSecondary: "Public API status overview.",
        fresh: "Fresh",
      },
    });
  });

  it("loads slug page through public API", async () => {
    mockLoadPublicStatusPageData.mockResolvedValue({
      initialPayload: {
        rebuildState: "fresh",
        sourceGeneration: "",
        generatedAt: "2026-04-22T10:00:00.000Z",
        freshUntil: "2026-04-22T10:05:00.000Z",
        groups: [
          {
            publicGroupSlug: "anthropic",
            displayName: "Anthropic",
            explanatoryCopy: "Anthropic public models",
            models: [],
          },
        ],
      },
      status: "ready",
      intervalMinutes: 5,
      rangeHours: 24,
      followServerDefaults: true,
      siteTitle: "Claude Code Hub",
      timeZone: "UTC",
      meta: {
        siteTitle: "Claude Code Hub",
        siteDescription: "Claude Code Hub public status",
        timeZone: "UTC",
      },
      response: {} as never,
    });

    const mod = await import("@/app/[locale]/status/[slug]/page");

    const element = await mod.default({
      params: Promise.resolve({ locale: "en", slug: "anthropic" }),
    });

    expect(mockLoadPublicStatusPageData).toHaveBeenCalledWith({ groupSlug: "anthropic" });
    expect((element as { props: { filterSlug: string } }).props).toMatchObject({
      filterSlug: "anthropic",
    });
  });
});
