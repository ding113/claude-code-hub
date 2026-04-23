import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSystemSettings = vi.hoisted(() => vi.fn());
const mockResolveSystemTimezone = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mockGetSystemSettings,
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: mockResolveSystemTimezone,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: mockLoggerWarn,
  },
}));

describe("layout-site-metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("falls back to default metadata when system settings lookup fails", async () => {
    mockGetSystemSettings.mockRejectedValue(new Error("db down"));

    const mod = await import("@/lib/layout-site-metadata");
    await expect(mod.resolveDefaultSiteMetadataSource()).resolves.toEqual({
      siteTitle: "Claude Code Hub",
      siteDescription: "Claude Code Hub",
    });
    expect(mockLoggerWarn).toHaveBeenCalled();
  });

  it("falls back to UTC when timezone resolution fails", async () => {
    mockResolveSystemTimezone.mockRejectedValue(new Error("tz down"));

    const mod = await import("@/lib/layout-site-metadata");
    await expect(mod.resolveDefaultLayoutTimeZone()).resolves.toBe("UTC");
    expect(mockLoggerWarn).toHaveBeenCalled();
  });
});
