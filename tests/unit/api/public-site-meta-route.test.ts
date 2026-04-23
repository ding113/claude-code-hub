import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadCurrentPublicStatusConfigSnapshot = vi.hoisted(() => vi.fn());
const mockResolvePublicStatusSiteDescription = vi.hoisted(() => vi.fn());
const mockGetSystemSettings = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/public-status/config-snapshot", () => ({
  readCurrentPublicStatusConfigSnapshot: mockReadCurrentPublicStatusConfigSnapshot,
  resolvePublicStatusSiteDescription: mockResolvePublicStatusSiteDescription,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mockGetSystemSettings,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: mockLoggerError,
  },
}));

describe("GET /api/public-site-meta", () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockResolvePublicStatusSiteDescription.mockImplementation(
      ({
        siteTitle,
        siteDescription,
      }: {
        siteTitle?: string | null;
        siteDescription?: string | null;
      }) => siteDescription?.trim() || `${siteTitle ?? "Claude Code Hub"} public status`
    );

    const mod = await import("@/app/api/public-site-meta/route");
    GET = mod.GET;
  });

  it("returns projected public site metadata", async () => {
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue({
      siteTitle: "Acme AI Hub",
      siteDescription: "Projected public status",
      timeZone: "Asia/Shanghai",
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=30, stale-while-revalidate=60");
    await expect(res.json()).resolves.toEqual({
      available: true,
      siteTitle: "Acme AI Hub",
      siteDescription: "Projected public status",
      timeZone: "Asia/Shanghai",
      source: "projection",
    });
    expect(mockGetSystemSettings).not.toHaveBeenCalled();
  });

  it("does not fallback when projection is missing", async () => {
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      available: false,
      siteTitle: null,
      siteDescription: null,
      timeZone: null,
      source: "projection",
      reason: "projection_missing",
    });
    expect(mockGetSystemSettings).not.toHaveBeenCalled();
  });

  it("returns 503 instead of default metadata when the projection read throws", async () => {
    const error = new Error("boom");
    mockReadCurrentPublicStatusConfigSnapshot.mockRejectedValue(error);

    const res = await GET();

    expect(mockLoggerError).toHaveBeenCalledWith("GET /api/public-site-meta failed", { error });
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({
      error: "Public site metadata unavailable",
    });
    expect(mockGetSystemSettings).not.toHaveBeenCalled();
  });
});
