import { beforeEach, describe, expect, it, vi } from "vitest";

const systemStatusRouteMocks = vi.hoisted(() => ({
  GET: vi.fn(),
  runtime: "nodejs",
  dynamic: "force-dynamic",
}));

vi.mock("@/app/api/system-status/route", () => systemStatusRouteMocks);

describe("GET /api/status alias", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-exports the system-status route handler", async () => {
    const expectedResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    systemStatusRouteMocks.GET.mockResolvedValue(expectedResponse);

    const routeModule = await import("@/app/api/status/route");
    const response = await routeModule.GET();

    expect(routeModule.runtime).toBe("nodejs");
    expect(routeModule.dynamic).toBe("force-dynamic");
    expect(systemStatusRouteMocks.GET).toHaveBeenCalledTimes(1);
    expect(response).toBe(expectedResponse);
  });
});
