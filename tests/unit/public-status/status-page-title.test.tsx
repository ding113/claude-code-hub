import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mockReadCurrentPublicStatusConfigSnapshot = vi.hoisted(() => vi.fn());
const mockReadPublicStatusPayload = vi.hoisted(() => vi.fn());
const mockReadPublicSiteMeta = vi.hoisted(() => vi.fn());
const mockPublicStatusView = vi.hoisted(() => vi.fn(() => null));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/lib/public-status/config-snapshot", () => ({
  readCurrentPublicStatusConfigSnapshot: mockReadCurrentPublicStatusConfigSnapshot,
}));

vi.mock("@/lib/public-status/read-store", () => ({
  readPublicStatusPayload: mockReadPublicStatusPayload,
}));

vi.mock("@/lib/public-status/rebuild-hints", () => ({
  schedulePublicStatusRebuild: vi.fn(),
}));

vi.mock("@/lib/public-site-meta", () => ({
  readPublicSiteMeta: mockReadPublicSiteMeta,
}));

vi.mock("@/app/[locale]/status/_components/public-status-view", () => ({
  PublicStatusView: mockPublicStatusView,
}));

describe("public status page title", () => {
  it("falls back to public site meta when the snapshot siteTitle is blank", async () => {
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue({
      configVersion: "cfg-1",
      siteTitle: "   ",
      timeZone: "UTC",
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [],
    });
    mockReadPublicSiteMeta.mockResolvedValue({
      siteTitle: "Claude Code Hub",
    });
    mockReadPublicStatusPayload.mockResolvedValue({
      rebuildState: "fresh",
      sourceGeneration: "gen-1",
      generatedAt: "2026-04-22T00:00:00.000Z",
      freshUntil: null,
      groups: [],
    });

    const mod = await import("@/app/[locale]/status/page");
    const pageElement = await mod.default({
      params: Promise.resolve({ locale: "en" }),
    });
    renderToStaticMarkup(pageElement);

    expect(mockPublicStatusView).toHaveBeenCalledWith(
      expect.objectContaining({
        siteTitle: "Claude Code Hub",
      }),
      undefined
    );
  });

  it("prefers a non-blank snapshot siteTitle over public site meta", async () => {
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue({
      configVersion: "cfg-1",
      siteTitle: "Snapshot Title",
      timeZone: "UTC",
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [],
    });
    mockReadPublicSiteMeta.mockResolvedValue({
      siteTitle: "Claude Code Hub",
    });
    mockReadPublicStatusPayload.mockResolvedValue({
      rebuildState: "fresh",
      sourceGeneration: "gen-1",
      generatedAt: "2026-04-22T00:00:00.000Z",
      freshUntil: null,
      groups: [],
    });

    const mod = await import("@/app/[locale]/status/page");
    const pageElement = await mod.default({
      params: Promise.resolve({ locale: "en" }),
    });
    renderToStaticMarkup(pageElement);

    expect(mockPublicStatusView).toHaveBeenCalledWith(
      expect.objectContaining({
        siteTitle: "Snapshot Title",
      }),
      undefined
    );
  });
});
