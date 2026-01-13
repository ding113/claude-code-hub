import { describe, expect, test, vi } from "vitest";

function makeQuery(result: unknown) {
  const promise = Promise.resolve(result) as unknown as {
    from: () => unknown;
    leftJoin: () => unknown;
    where: () => unknown;
    orderBy: () => unknown;
    limit: () => unknown;
  };

  const chain = () => promise;

  promise.from = chain;
  promise.leftJoin = chain;
  promise.where = chain;
  promise.orderBy = chain;
  promise.limit = chain;

  return promise;
}

describe("endpoint-availability", () => {
  test("queryEndpointAvailability: aggregates probe events into buckets and statuses", async () => {
    vi.resetModules();

    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-01-01T01:00:00.000Z");

    const selectResults: unknown[] = [
      [
        {
          id: 1,
          vendorId: 10,
          providerType: "claude",
          baseUrl: "https://a.example",
          isEnabled: true,
          vendorName: "Vendor A",
        },
        {
          id: 2,
          vendorId: 10,
          providerType: "claude",
          baseUrl: "https://b.example",
          isEnabled: true,
          vendorName: "Vendor A",
        },
      ],
      [
        {
          endpointId: 1,
          result: "success",
          latencyMs: 100,
          checkedAt: new Date("2026-01-01T00:10:00.000Z"),
        },
        {
          endpointId: 1,
          result: "success",
          latencyMs: 200,
          checkedAt: new Date("2026-01-01T00:20:00.000Z"),
        },
        {
          endpointId: 1,
          result: "fail",
          latencyMs: 300,
          checkedAt: new Date("2026-01-01T00:30:00.000Z"),
        },
      ],
    ];

    const db = {
      select: vi.fn(() => makeQuery(selectResults.shift() ?? [])),
    };

    vi.doMock("@/drizzle/db", () => ({ db }));

    vi.doMock("@/lib/logger", () => ({
      logger: {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
      },
    }));

    const { queryEndpointAvailability } = await import("@/lib/endpoint-availability");

    const result = await queryEndpointAvailability({
      startTime: start,
      endTime: end,
      bucketSizeMinutes: 60,
      maxBuckets: 10,
    });

    expect(result.startTime).toBe(start.toISOString());
    expect(result.endTime).toBe(end.toISOString());
    expect(result.endpoints).toHaveLength(2);

    const endpoint1 = result.endpoints.find((e) => e.endpointId === 1);
    const endpoint2 = result.endpoints.find((e) => e.endpointId === 2);

    expect(endpoint1?.totalProbes).toBe(3);
    expect(endpoint1?.currentAvailability).toBeCloseTo(2 / 3, 5);
    expect(endpoint1?.currentStatus).toBe("green");
    expect(endpoint1?.timeBuckets).toHaveLength(1);

    expect(endpoint2?.totalProbes).toBe(0);
    expect(endpoint2?.currentStatus).toBe("unknown");

    expect(result.systemAvailability).toBeCloseTo(2 / 3, 5);
  });
});
