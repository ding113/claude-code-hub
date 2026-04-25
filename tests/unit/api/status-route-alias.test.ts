import { beforeEach, describe, expect, it, vi } from "vitest";

const publicStatusRouteMocks = vi.hoisted(() => ({
  GET: vi.fn(),
}));

vi.mock("@/app/api/public-status/route", () => publicStatusRouteMocks);

describe("GET /api/status alias", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-exports the public-status route handler", async () => {
    const expectedResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    publicStatusRouteMocks.GET.mockResolvedValue(expectedResponse);

    const routeModule = await import("@/app/api/status/route");
    const response = await routeModule.GET();

    expect(routeModule.runtime).toBe("nodejs");
    expect(routeModule.dynamic).toBe("force-dynamic");
    expect(publicStatusRouteMocks.GET).toHaveBeenCalledTimes(1);
    expect(response).toBe(expectedResponse);
  });
});
