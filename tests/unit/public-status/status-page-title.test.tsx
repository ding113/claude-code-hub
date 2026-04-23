import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mockLoadPublicStatusPageData = vi.hoisted(() => vi.fn());
const mockPublicStatusView = vi.hoisted(() => vi.fn(() => null));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/lib/public-status/public-api-loader", () => ({
  loadPublicStatusPageData: mockLoadPublicStatusPageData,
}));

vi.mock("@/app/[locale]/status/_components/public-status-view", () => ({
  PublicStatusView: mockPublicStatusView,
}));

describe("public status page title", () => {
  it("forwards the loader-provided site title", async () => {
    mockLoadPublicStatusPageData.mockResolvedValue({
      initialPayload: {
        rebuildState: "fresh",
        sourceGeneration: "",
        generatedAt: "2026-04-22T00:00:00.000Z",
        freshUntil: null,
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

  it("forwards the loader-provided timezone", async () => {
    mockLoadPublicStatusPageData.mockResolvedValue({
      initialPayload: {
        rebuildState: "fresh",
        sourceGeneration: "",
        generatedAt: "2026-04-22T00:00:00.000Z",
        freshUntil: null,
        groups: [],
      },
      status: "ready",
      intervalMinutes: 5,
      rangeHours: 24,
      followServerDefaults: true,
      siteTitle: "Snapshot Title",
      timeZone: "Asia/Shanghai",
      meta: {
        siteTitle: "Snapshot Title",
        siteDescription: "Snapshot public status",
        timeZone: "Asia/Shanghai",
      },
    });

    const mod = await import("@/app/[locale]/status/page");
    const pageElement = await mod.default({
      params: Promise.resolve({ locale: "en" }),
    });
    renderToStaticMarkup(pageElement);

    expect(mockPublicStatusView).toHaveBeenCalledWith(
      expect.objectContaining({
        siteTitle: "Snapshot Title",
        timeZone: "Asia/Shanghai",
      }),
      undefined
    );
  });
});
