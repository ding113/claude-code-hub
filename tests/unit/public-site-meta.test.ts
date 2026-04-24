import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadPublicStatusSiteMetadata = vi.hoisted(() => vi.fn());
const mockGetSystemSettings = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mockGetSystemSettings,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: mockLoggerWarn,
  },
}));

vi.mock("@/lib/public-status/config-snapshot", async () => {
  const actual = await vi.importActual<typeof import("@/lib/public-status/config-snapshot")>(
    "@/lib/public-status/config-snapshot"
  );

  return {
    ...actual,
    readPublicStatusSiteMetadata: mockReadPublicStatusSiteMetadata,
  };
});

describe("readPublicSiteMeta", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("prefers public snapshot metadata before querying system settings", async () => {
    mockReadPublicStatusSiteMetadata.mockResolvedValue({
      siteTitle: "Status Title",
      siteDescription: "Status Title public status",
    });

    const { readPublicSiteMeta } = await import("@/lib/public-site-meta");

    await expect(readPublicSiteMeta()).resolves.toEqual({
      siteTitle: "Status Title",
      siteDescription: "Status Title public status",
    });
    expect(mockGetSystemSettings).not.toHaveBeenCalled();
  });

  it("falls back to system settings title when snapshot metadata is unavailable", async () => {
    mockReadPublicStatusSiteMetadata.mockResolvedValue(null);
    mockGetSystemSettings.mockResolvedValue({
      siteTitle: "Acme AI Hub",
    });

    const { readPublicSiteMeta } = await import("@/lib/public-site-meta");

    await expect(readPublicSiteMeta()).resolves.toEqual({
      siteTitle: "Acme AI Hub",
      siteDescription: "Acme AI Hub public status",
    });
  });

  it("logs and falls back to default metadata when system settings lookup fails", async () => {
    mockReadPublicStatusSiteMetadata.mockResolvedValue(null);
    mockGetSystemSettings.mockRejectedValue(new Error("db down"));

    const { readPublicSiteMeta } = await import("@/lib/public-site-meta");

    await expect(readPublicSiteMeta()).resolves.toEqual({
      siteTitle: "Claude Code Hub",
      siteDescription: "Claude Code Hub public status",
    });
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "readPublicSiteMeta: failed to load system settings; falling back to defaults",
      expect.objectContaining({
        error: "db down",
      })
    );
  });
});
