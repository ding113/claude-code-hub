import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getModelPricesPaginated: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/actions/model-prices", () => ({
  getModelPricesPaginated: mocks.getModelPricesPaginated,
}));

describe("GET /api/prices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when session is missing", async () => {
    mocks.getSession.mockResolvedValue(null);

    const { GET } = await import("@/app/api/prices/route");
    const response = await GET({ url: "http://localhost/api/prices" } as any);
    expect(response.status).toBe(403);
  });

  it("returns 403 when user is not admin", async () => {
    mocks.getSession.mockResolvedValue({ user: { role: "user" } });

    const { GET } = await import("@/app/api/prices/route");
    const response = await GET({ url: "http://localhost/api/prices" } as any);
    expect(response.status).toBe(403);
  });

  it("returns 400 when page is NaN", async () => {
    mocks.getSession.mockResolvedValue({ user: { role: "admin" } });

    const { GET } = await import("@/app/api/prices/route");
    const response = await GET({ url: "http://localhost/api/prices?page=abc&pageSize=50" } as any);
    expect(response.status).toBe(400);
  });

  it("returns 400 when pageSize is NaN", async () => {
    mocks.getSession.mockResolvedValue({ user: { role: "admin" } });

    const { GET } = await import("@/app/api/prices/route");
    const response = await GET({ url: "http://localhost/api/prices?page=1&pageSize=abc" } as any);
    expect(response.status).toBe(400);
  });

  it("returns ok=true when params are valid", async () => {
    mocks.getSession.mockResolvedValue({ user: { role: "admin" } });
    mocks.getModelPricesPaginated.mockResolvedValue({
      ok: true,
      data: {
        data: [],
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 0,
      },
    });

    const { GET } = await import("@/app/api/prices/route");
    const response = await GET({ url: "http://localhost/api/prices?page=1&pageSize=50" } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(mocks.getModelPricesPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 50 })
    );
  });
});
