import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getPublicStatusSnapshotMock = vi.hoisted(() => vi.fn());

vi.mock("@/repository/public-status-snapshot", () => ({
  getPublicStatusSnapshot: () => getPublicStatusSnapshotMock(),
}));

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/public-status");
}

describe("GET /api/public-status", () => {
  let GET: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    const mod = await import("@/app/api/public-status/route");
    GET = mod.GET;
  });

  it("未配置公开状态快照时返回 404", async () => {
    getPublicStatusSnapshotMock.mockResolvedValueOnce(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      errorCode: "PUBLIC_STATUS_NOT_CONFIGURED",
    });
  });

  it("存在公开状态快照时直接返回快照数据", async () => {
    getPublicStatusSnapshotMock.mockResolvedValueOnce({
      generatedAt: "2026-04-21T00:00:00.000Z",
      groups: [{ groupName: "alpha" }],
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      generatedAt: "2026-04-21T00:00:00.000Z",
      groups: [{ groupName: "alpha" }],
    });
  });
});
