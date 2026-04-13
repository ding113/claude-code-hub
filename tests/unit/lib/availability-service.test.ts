import { beforeEach, describe, expect, it, vi } from "vitest";

function createThenableQuery<T>(result: T) {
  const query: {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    then: Promise<T>["then"];
    catch: Promise<T>["catch"];
    finally: Promise<T>["finally"];
  } & Promise<T> = Promise.resolve(result) as never;

  query.from = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(() => query);

  return query;
}

function sqlToString(sqlObject: unknown): string {
  const visited = new Set<unknown>();

  const walk = (node: unknown): string => {
    if (node === null || node === undefined || visited.has(node)) return "";

    if (typeof node === "string") return node;
    if (typeof node === "number" || typeof node === "boolean" || typeof node === "bigint") {
      return String(node);
    }

    if (typeof node === "object") {
      visited.add(node);

      const anyNode = node as {
        name?: unknown;
        value?: unknown;
        queryChunks?: unknown[];
      };

      if (Array.isArray(anyNode)) {
        return anyNode.map(walk).join("");
      }

      if (typeof anyNode.name === "string") {
        return anyNode.name;
      }

      if (Array.isArray(anyNode.value)) {
        return anyNode.value.map(walk).join("");
      }

      if (typeof anyNode.value === "string") {
        return anyNode.value;
      }

      if (anyNode.queryChunks) {
        return walk(anyNode.queryChunks);
      }
    }

    return "";
  };

  return walk(sqlObject);
}

describe("availability-service", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("classifyRequestStatus 不应把 1xx 当成成功", async () => {
    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: vi.fn(),
        execute: vi.fn(),
      },
    }));

    const { classifyRequestStatus } = await import("@/lib/availability/availability-service");

    expect(classifyRequestStatus(101)).toEqual({
      status: "red",
      isSuccess: false,
      isError: true,
    });
  });

  it("queryProviderAvailability 改为数据库聚合后仍只统计终态请求", async () => {
    const selectMock = vi.fn(() =>
      createThenableQuery([
        {
          id: 1,
          name: "Provider A",
          providerType: "claude",
          enabled: true,
        },
      ])
    );
    const executeMock = vi.fn(async () => [
      {
        providerId: 1,
        bucketStart: new Date("2026-04-13T08:00:00.000Z"),
        totalRequests: 3,
        greenCount: 2,
        redCount: 1,
        latencyCount: 2,
        latencySumMs: 360,
        avgLatencyMs: 180,
        p50LatencyMs: 120,
        p95LatencyMs: 240,
        p99LatencyMs: 240,
        lastRequestAt: new Date("2026-04-13T08:03:00.000Z"),
      },
    ]);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: executeMock,
      },
    }));

    const { queryProviderAvailability } = await import("@/lib/availability/availability-service");
    const result = await queryProviderAvailability({
      startTime: new Date("2026-04-13T07:00:00.000Z"),
      endTime: new Date("2026-04-13T09:00:00.000Z"),
      bucketSizeMinutes: 60,
    });

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]).toMatchObject({
      providerId: 1,
      totalRequests: 3,
      currentAvailability: 2 / 3,
      successRate: 2 / 3,
      currentStatus: "green",
      avgLatencyMs: 180,
      lastRequestAt: "2026-04-13T08:03:00.000Z",
    });
    expect(result.providers[0]?.timeBuckets).toHaveLength(1);
    expect(result.providers[0]?.timeBuckets[0]).toMatchObject({
      totalRequests: 3,
      greenCount: 2,
      redCount: 1,
      availabilityScore: 2 / 3,
      avgLatencyMs: 180,
      p50LatencyMs: 120,
      p95LatencyMs: 240,
      p99LatencyMs: 240,
    });

    const queryText = sqlToString(executeMock.mock.calls[0]?.[0]).toLowerCase();
    expect(queryText).toContain("statuscode");
    expect(queryText).toContain("is not null");
    expect(queryText).toContain("group by");
    expect(queryText).toContain("percentile_cont(0.95)");
    expect(queryText).toContain("row_number() over");
  });

  it("queryProviderAvailability 在无聚合数据时仍返回 unknown 提供商状态", async () => {
    const selectMock = vi.fn(() =>
      createThenableQuery([
        {
          id: 1,
          name: "Provider A",
          providerType: "claude",
          enabled: true,
        },
      ])
    );
    const executeMock = vi.fn(async () => []);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: executeMock,
      },
    }));

    const { queryProviderAvailability } = await import("@/lib/availability/availability-service");
    const result = await queryProviderAvailability({
      startTime: new Date("2026-04-13T07:00:00.000Z"),
      endTime: new Date("2026-04-13T09:00:00.000Z"),
      bucketSizeMinutes: 60,
    });

    expect(result.providers).toEqual([
      {
        providerId: 1,
        providerName: "Provider A",
        providerType: "claude",
        isEnabled: true,
        currentStatus: "unknown",
        currentAvailability: 0,
        totalRequests: 0,
        successRate: 0,
        avgLatencyMs: 0,
        lastRequestAt: null,
        timeBuckets: [],
      },
    ]);
  });

  it("getCurrentProviderStatus 改为数据库聚合后仍只统计终态请求", async () => {
    const selectMock = vi.fn(() =>
      createThenableQuery([
        {
          id: 1,
          name: "Provider A",
        },
      ])
    );
    const executeMock = vi.fn(async () => [
      {
        providerId: 1,
        greenCount: 1,
        redCount: 1,
        lastRequestAt: new Date("2026-04-13T08:02:00.000Z"),
      },
    ]);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: executeMock,
      },
    }));

    const { getCurrentProviderStatus } = await import("@/lib/availability/availability-service");
    const result = await getCurrentProviderStatus();

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        providerId: 1,
        providerName: "Provider A",
        status: "green",
        availability: 0.5,
        requestCount: 2,
        lastRequestAt: "2026-04-13T08:02:00.000Z",
      },
    ]);

    const queryText = sqlToString(executeMock.mock.calls[0]?.[0]).toLowerCase();
    expect(queryText).toContain("status_code");
    expect(queryText).toContain("is not null");
    expect(queryText).toContain("count(*) filter");
    expect(queryText).toContain("max(");
  });
});
