import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadPublicStatusSiteMetadata = vi.hoisted(() => vi.fn());
const mockGetSystemSettings = vi.hoisted(() => vi.fn());

vi.mock("@/lib/public-status/config-snapshot", async () => {
  const actual = await vi.importActual<typeof import("@/lib/public-status/config-snapshot")>(
    "@/lib/public-status/config-snapshot"
  );

  return {
    ...actual,
    readPublicStatusSiteMetadata: mockReadPublicStatusSiteMetadata,
    readPublicStatusTimeZone: vi.fn(),
  };
});

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mockGetSystemSettings,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: () => {},
    warn: () => {},
  },
}));

describe("layout metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses public-status redis metadata only for public status requests", async () => {
    mockGetSystemSettings.mockResolvedValue({
      siteTitle: "   ",
    });
    mockReadPublicStatusSiteMetadata.mockResolvedValue({
      siteTitle: "Status Title",
      siteDescription: "Status Description",
    });

    const { resolveSiteMetadataSource } = await import("@/lib/public-status/layout-metadata");
    const metadata = await resolveSiteMetadataSource({
      isPublicStatusRequest: true,
    });

    expect(metadata?.siteTitle).toBe("Status Title");
    expect(metadata?.siteDescription).toBe("Status Description");
    expect(mockGetSystemSettings).not.toHaveBeenCalled();
  });

  it("keeps non-status pages on system settings metadata", async () => {
    mockGetSystemSettings.mockResolvedValue({
      siteTitle: "Custom Site",
    });

    const { resolveSiteMetadataSource } = await import("@/lib/public-status/layout-metadata");
    const metadata = await resolveSiteMetadataSource({
      isPublicStatusRequest: false,
    });

    expect(metadata?.siteTitle).toBe("Custom Site");
    expect(metadata?.siteDescription).toBe("Custom Site");
    expect(mockReadPublicStatusSiteMetadata).not.toHaveBeenCalled();
  });
});
