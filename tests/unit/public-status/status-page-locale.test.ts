import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetTranslations = vi.hoisted(() => vi.fn());
const mockReadCurrentPublicStatusConfigSnapshot = vi.hoisted(() => vi.fn());
const mockReadPublicStatusSiteMetadata = vi.hoisted(() => vi.fn());
const mockResolvePublicStatusSiteDescription = vi.hoisted(() => vi.fn());
const mockReadPublicStatusPayload = vi.hoisted(() => vi.fn());
const mockSchedulePublicStatusRebuild = vi.hoisted(() => vi.fn());
const mockPublicStatusView = vi.hoisted(() => vi.fn(() => null));

vi.mock("next-intl/server", () => ({
  getTranslations: mockGetTranslations,
}));

vi.mock("@/lib/public-status/config-snapshot", () => ({
  readCurrentPublicStatusConfigSnapshot: mockReadCurrentPublicStatusConfigSnapshot,
  readPublicStatusSiteMetadata: mockReadPublicStatusSiteMetadata,
  resolvePublicStatusSiteDescription: mockResolvePublicStatusSiteDescription,
}));

vi.mock("@/lib/public-status/read-store", () => ({
  readPublicStatusPayload: mockReadPublicStatusPayload,
}));

vi.mock("@/lib/public-status/rebuild-hints", () => ({
  schedulePublicStatusRebuild: mockSchedulePublicStatusRebuild,
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
            heroSecondary: "Redis-backed public runtime health overview.",
            generatedAt: "Updated",
            history: "History",
            availability: "Availability",
            ttfb: "TTFB",
            tps: "TPS",
            freshnessWindow: "Snapshot freshness",
            fresh: "Fresh",
            stale: "Stale",
            staleDetail: "The latest completed snapshot is still shown while a refresh is pending.",
            rebuilding: "Rebuilding",
            noData: "No data",
            operational: "Operational",
            failed: "Failed",
            emptyDescription: "We are preparing the first public snapshot for this page.",
            past: "Past",
            now: "Now",
            "requestTypes.openaiCompatible": "OpenAI Compatible",
            "requestTypes.codex": "Codex",
            "requestTypes.anthropic": "Anthropic",
            "requestTypes.gemini": "Gemini",
          };

          return entries[key] ?? key;
        };
      }

      return (key: string) => `zh:${key}`;
    });
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue(null);
    mockReadPublicStatusSiteMetadata.mockResolvedValue(null);
    mockResolvePublicStatusSiteDescription.mockImplementation(
      ({ siteTitle, siteDescription }: { siteTitle?: string; siteDescription?: string }) =>
        siteDescription ?? `${siteTitle ?? "Claude Code Hub"} public status`
    );
    mockReadPublicStatusPayload.mockResolvedValue({
      rebuildState: "fresh",
      sourceGeneration: "gen-1",
      generatedAt: "2026-04-22T10:00:00.000Z",
      freshUntil: "2026-04-22T10:05:00.000Z",
      groups: [],
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

    const props = (
      element as {
        props: { labels: { heroPrimary: string; heroSecondary: string; fresh: string } };
      }
    ).props;

    expect(props.labels.heroPrimary).toBe("AI SERVICES");
    expect(props.labels.heroSecondary).toBe("Redis-backed public runtime health overview.");
    expect(props.labels.fresh).toBe("Fresh");
  });
});
