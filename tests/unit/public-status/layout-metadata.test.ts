import { beforeEach, describe, expect, it, vi } from "vitest";
import { importPublicStatusModule } from "../../helpers/public-status-test-helpers";

vi.mock("@/lib/public-status/config-snapshot", () => ({
  readPublicStatusSiteMetadata: vi.fn(),
  readPublicStatusTimeZone: vi.fn(),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(),
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn(),
}));

interface LayoutMetadataModule {
  resolveSiteMetadataSource(input: { isPublicStatusRequest: boolean }): Promise<{
    siteTitle: string;
    siteDescription: string;
  } | null>;
  resolveLayoutTimeZone(input: { isPublicStatusRequest: boolean }): Promise<string>;
}

describe("public-status layout metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("reads site metadata from the redis projection for public status requests", async () => {
    const { readPublicStatusSiteMetadata } = await import("@/lib/public-status/config-snapshot");
    vi.mocked(readPublicStatusSiteMetadata).mockResolvedValue({
      siteTitle: "Claude Code Hub Status",
      siteDescription: "Redis-only public status",
    });

    const mod = await importPublicStatusModule<LayoutMetadataModule>(
      "@/lib/public-status/layout-metadata"
    );

    await expect(mod.resolveSiteMetadataSource({ isPublicStatusRequest: true })).resolves.toEqual({
      siteTitle: "Claude Code Hub Status",
      siteDescription: "Redis-only public status",
    });

    const { getSystemSettings } = await import("@/repository/system-config");
    expect(vi.mocked(getSystemSettings)).not.toHaveBeenCalled();
  });

  it("reads timezone from the redis projection for public status requests", async () => {
    const { readPublicStatusTimeZone } = await import("@/lib/public-status/config-snapshot");
    vi.mocked(readPublicStatusTimeZone).mockResolvedValue("Asia/Shanghai");

    const mod = await importPublicStatusModule<LayoutMetadataModule>(
      "@/lib/public-status/layout-metadata"
    );

    await expect(mod.resolveLayoutTimeZone({ isPublicStatusRequest: true })).resolves.toBe(
      "Asia/Shanghai"
    );

    const { resolveSystemTimezone } = await import("@/lib/utils/timezone");
    expect(vi.mocked(resolveSystemTimezone)).not.toHaveBeenCalled();
  });
});
