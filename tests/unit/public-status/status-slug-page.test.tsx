import type { Metadata } from "next";
import { describe, expect, it, vi } from "vitest";

const mockLoadPublicStatusPageData = vi.hoisted(() => vi.fn());
const mockNotFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  })
);

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  notFound: mockNotFound,
}));

vi.mock("@/lib/public-status/public-api-loader", () => ({
  loadPublicStatusPageData: mockLoadPublicStatusPageData,
}));

vi.mock("@/app/[locale]/status/_components/public-status-view", () => ({
  PublicStatusView: () => null,
}));

describe("public status slug page", () => {
  it("generates metadata from the public API loader", async () => {
    mockLoadPublicStatusPageData.mockResolvedValue({
      initialPayload: {
        rebuildState: "fresh",
        sourceGeneration: "",
        generatedAt: "2026-04-22T00:00:00.000Z",
        freshUntil: null,
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
    const metadata = (await mod.generateMetadata({
      params: Promise.resolve({ slug: "anthropic" }),
    })) as Metadata;

    expect(mockLoadPublicStatusPageData).toHaveBeenCalledWith({ groupSlug: "anthropic" });
    expect(metadata).toMatchObject({
      title: "Anthropic · Claude Code Hub",
      description: "Anthropic public models",
    });
  });

  it("keeps unknown slugs on the existing notFound flow", async () => {
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
      response: {} as never,
    });

    const mod = await import("@/app/[locale]/status/[slug]/page");

    await expect(
      mod.default({
        params: Promise.resolve({ locale: "en", slug: "missing-group" }),
      })
    ).rejects.toThrow("NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalled();
  });

  it("returns site-level metadata for unknown slugs without calling notFound during metadata generation", async () => {
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
      response: {} as never,
    });

    const mod = await import("@/app/[locale]/status/[slug]/page");
    const metadata = (await mod.generateMetadata({
      params: Promise.resolve({ slug: "missing-group" }),
    })) as Metadata;

    expect(metadata).toEqual({
      title: "Claude Code Hub",
    });
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});
