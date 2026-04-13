import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockQueryProviderAvailability = vi.hoisted(() => vi.fn());
const MockAvailabilityQueryValidationError = vi.hoisted(
  () =>
    class AvailabilityQueryValidationError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "AvailabilityQueryValidationError";
      }
    }
);

vi.mock("@/lib/auth", () => ({
  getSession: mockGetSession,
}));

vi.mock("@/lib/availability", () => ({
  AvailabilityQueryValidationError: MockAvailabilityQueryValidationError,
  MIN_BUCKET_SIZE_MINUTES: 0.25,
  MAX_BUCKETS_HARD_LIMIT: 100,
  MAX_BUCKET_SIZE_MINUTES: 1440,
  queryProviderAvailability: mockQueryProviderAvailability,
}));

function makeRequest(query = ""): NextRequest {
  const suffix = query ? `?${query}` : "";
  return new NextRequest(`http://localhost/api/availability${suffix}`);
}

describe("GET /api/availability", () => {
  let GET: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: {
        id: 1,
        role: "admin",
      },
    });
    mockQueryProviderAvailability.mockResolvedValue({
      queriedAt: "2026-04-13T09:00:00.000Z",
      startTime: "2026-04-13T08:00:00.000Z",
      endTime: "2026-04-13T09:00:00.000Z",
      bucketSizeMinutes: 5,
      providers: [],
      systemAvailability: 0,
    });

    const mod = await import("@/app/api/availability/route");
    GET = mod.GET;
  });

  it("未认证时返回 401", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockQueryProviderAvailability).not.toHaveBeenCalled();
  });

  it("参数合法时将规范化后的查询参数传给 service", async () => {
    const res = await GET(
      makeRequest(
        [
          "startTime=2026-04-13T08:00:00.000Z",
          "endTime=2026-04-13T09:00:00.000Z",
          "providerIds=2,1,2",
          "bucketSizeMinutes=0.5",
          "includeDisabled=true",
          "maxBuckets=60",
        ].join("&")
      )
    );

    expect(res.status).toBe(200);
    expect(mockQueryProviderAvailability).toHaveBeenCalledTimes(1);
    expect(mockQueryProviderAvailability).toHaveBeenCalledWith({
      startTime: "2026-04-13T08:00:00.000Z",
      endTime: "2026-04-13T09:00:00.000Z",
      providerIds: [2, 1],
      bucketSizeMinutes: 0.5,
      includeDisabled: true,
      maxBuckets: 60,
    });
  });

  it("providerIds 非法时返回 400 且不访问 service", async () => {
    const res = await GET(makeRequest("providerIds=1,foo"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid providerIds: expected a positive integer",
    });
    expect(mockQueryProviderAvailability).not.toHaveBeenCalled();
  });

  it("providerIds 存在空 token 时返回 400 且不访问 service", async () => {
    const res = await GET(makeRequest("providerIds=1,,2"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid providerIds: expected comma-separated positive integers",
    });
    expect(mockQueryProviderAvailability).not.toHaveBeenCalled();
  });

  it("includeDisabled 非法时返回 400 且不访问 service", async () => {
    const res = await GET(makeRequest("includeDisabled=yes"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid includeDisabled: expected true or false",
    });
    expect(mockQueryProviderAvailability).not.toHaveBeenCalled();
  });

  it("bucketSizeMinutes 为 Infinity 时返回 400 且不访问 service", async () => {
    const res = await GET(makeRequest("bucketSizeMinutes=Infinity"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid bucketSizeMinutes: expected a positive number",
    });
    expect(mockQueryProviderAvailability).not.toHaveBeenCalled();
  });

  it("bucketSizeMinutes 低于最小值时返回 400 且不访问 service", async () => {
    const res = await GET(makeRequest("bucketSizeMinutes=0.001"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid bucketSizeMinutes: expected a positive number not less than 0.25",
    });
    expect(mockQueryProviderAvailability).not.toHaveBeenCalled();
  });

  it("bucketSizeMinutes 超过硬上限时返回 400 且不访问 service", async () => {
    const res = await GET(makeRequest("bucketSizeMinutes=1441"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid bucketSizeMinutes: expected a positive number not greater than 1440",
    });
    expect(mockQueryProviderAvailability).not.toHaveBeenCalled();
  });

  it("maxBuckets 超过硬上限时返回 400 且不访问 service", async () => {
    const res = await GET(makeRequest("maxBuckets=101"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid maxBuckets: expected a positive integer not greater than 100",
    });
    expect(mockQueryProviderAvailability).not.toHaveBeenCalled();
  });

  it("空的 startTime 参数返回 400 且不访问 service", async () => {
    const res = await GET(makeRequest("startTime="));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid startTime: expected a valid Date or ISO timestamp",
    });
    expect(mockQueryProviderAvailability).not.toHaveBeenCalled();
  });

  it("service 抛出参数校验错误时映射为 400", async () => {
    mockQueryProviderAvailability.mockRejectedValueOnce(
      new MockAvailabilityQueryValidationError(
        "Invalid time range: endTime must be greater than or equal to startTime"
      )
    );

    const res = await GET(
      makeRequest("startTime=2026-04-13T09:00:00.000Z&endTime=2026-04-13T08:00:00.000Z")
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid time range: endTime must be greater than or equal to startTime",
    });
  });

  it("service 抛出非校验错误时返回 500", async () => {
    mockQueryProviderAvailability.mockRejectedValueOnce(new Error("db down"));

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});
