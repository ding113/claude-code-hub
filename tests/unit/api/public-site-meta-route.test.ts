import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SITE_TITLE } from "@/lib/site-title";

const mockReadPublicSiteMeta = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/public-site-meta", () => ({
  readPublicSiteMeta: mockReadPublicSiteMeta,
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

    const mod = await import("@/app/api/public-site-meta/route");
    GET = mod.GET;
  });

  it("returns public branding metadata with cache headers", async () => {
    mockReadPublicSiteMeta.mockResolvedValue({
      siteTitle: "Acme AI Hub",
      siteDescription: "Acme AI Hub public status",
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=30, stale-while-revalidate=60");
    await expect(res.json()).resolves.toEqual({
      siteTitle: "Acme AI Hub",
      siteDescription: "Acme AI Hub public status",
    });
  });

  it("logs and falls back to default metadata when the read fails", async () => {
    const error = new Error("boom");
    mockReadPublicSiteMeta.mockRejectedValue(error);

    const res = await GET();

    expect(mockLoggerError).toHaveBeenCalledWith("GET /api/public-site-meta failed", { error });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      siteTitle: DEFAULT_SITE_TITLE,
      siteDescription: `${DEFAULT_SITE_TITLE} public status`,
    });
  });
});
