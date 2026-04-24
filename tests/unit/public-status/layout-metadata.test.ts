import { beforeEach, describe, expect, it, vi } from "vitest";
import { importPublicStatusModule } from "../../helpers/public-status-test-helpers";

const mockLoadPublicSiteMeta = vi.hoisted(() => vi.fn());
const mockGetSystemSettings = vi.hoisted(() => vi.fn());
const mockResolveSystemTimezone = vi.hoisted(() => vi.fn());

vi.mock("@/lib/public-status/public-api-loader", () => ({
  loadPublicSiteMeta: mockLoadPublicSiteMeta,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mockGetSystemSettings,
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: mockResolveSystemTimezone,
}));

interface LayoutMetadataModule {
  resolveSiteMetadataSource(): Promise<{
    siteTitle: string;
    siteDescription: string;
  } | null>;
  resolveLayoutTimeZone(): Promise<string>;
}

describe("public-status layout metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("reads site metadata from the public site meta loader for public status requests", async () => {
    mockLoadPublicSiteMeta.mockResolvedValue({
      available: true,
      siteTitle: "Claude Code Hub Status",
      siteDescription: "Projection-only public status",
      timeZone: "UTC",
      source: "projection",
    });

    const mod = await importPublicStatusModule<LayoutMetadataModule>(
      "@/lib/public-status/layout-metadata"
    );

    await expect(mod.resolveSiteMetadataSource()).resolves.toEqual({
      siteTitle: "Claude Code Hub Status",
      siteDescription: "Projection-only public status",
    });

    expect(mockGetSystemSettings).not.toHaveBeenCalled();
  });

  it("falls back to null metadata when the projection is unavailable", async () => {
    mockLoadPublicSiteMeta.mockResolvedValue({
      available: false,
      siteTitle: null,
      siteDescription: null,
      timeZone: null,
      source: "projection",
      reason: "projection_missing",
    });

    const mod = await importPublicStatusModule<LayoutMetadataModule>(
      "@/lib/public-status/layout-metadata"
    );

    await expect(mod.resolveSiteMetadataSource()).resolves.toBeNull();
    expect(mockGetSystemSettings).not.toHaveBeenCalled();
  });

  it("reads timezone from the public site meta loader for public status requests", async () => {
    mockLoadPublicSiteMeta.mockResolvedValue({
      available: true,
      siteTitle: "Claude Code Hub Status",
      siteDescription: "Projection-only public status",
      timeZone: "Asia/Shanghai",
      source: "projection",
    });

    const mod = await importPublicStatusModule<LayoutMetadataModule>(
      "@/lib/public-status/layout-metadata"
    );

    await expect(mod.resolveLayoutTimeZone()).resolves.toBe("Asia/Shanghai");

    expect(mockResolveSystemTimezone).not.toHaveBeenCalled();
  });
});
