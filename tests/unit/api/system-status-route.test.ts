import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicSystemStatusSnapshot: vi.fn(),
  logger: {
    error: vi.fn(),
  },
}));

vi.mock("@/lib/system-status", () => ({
  getPublicSystemStatusSnapshot: mocks.getPublicSystemStatusSnapshot,
}));

vi.mock("@/lib/logger", () => ({
  logger: mocks.logger,
}));

describe("GET /api/system-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a public snapshot with cache headers", async () => {
    mocks.getPublicSystemStatusSnapshot.mockResolvedValue({
      queriedAt: "2026-04-15T12:00:00.000Z",
      summary: { providerCount: 1 },
      providers: [],
    });

    const { GET } = await import("@/app/api/system-status/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=120"
    );
    await expect(response.json()).resolves.toEqual({
      queriedAt: "2026-04-15T12:00:00.000Z",
      summary: { providerCount: 1 },
      providers: [],
    });
  });

  it("returns 500 when snapshot generation fails", async () => {
    mocks.getPublicSystemStatusSnapshot.mockRejectedValue(new Error("db offline"));

    const { GET } = await import("@/app/api/system-status/route");
    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to fetch system status",
    });
    expect(mocks.logger.error).toHaveBeenCalled();
  });
});
