import type { SQL } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";
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

function sqlToQuery(sqlObject: unknown) {
  return (sqlObject as SQL).toQuery({
    escapeName: (name: string) => `"${name}"`,
    escapeParam: (num: number, _value: unknown) => `$${num}`,
    escapeString: (value: string) => `'${value}'`,
    casing: new CasingCache(),
    paramStartIndex: { value: 1 },
  });
}

function sqlToString(sqlObject: unknown): string {
  return sqlToQuery(sqlObject).sql;
}

function normalizeSql(sqlObject: unknown): string {
  return sqlToString(sqlObject).replace(/\s+/g, " ").trim().toLowerCase();
}

function extractFinalizedRequestsSql(queryText: string): string {
  const start = queryText.indexOf("finalized_requests as");
  const end = queryText.indexOf("provider_bucket_stats as");

  if (start === -1 || end === -1 || end <= start) {
    return queryText;
  }

  return queryText.slice(start, end);
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

  it("queryProviderAvailability 在非法时间参数时抛出明确错误且不访问数据库", async () => {
    const selectMock = vi.fn(() => createThenableQuery([]));
    const executeMock = vi.fn(async () => []);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: executeMock,
      },
    }));

    const { queryProviderAvailability } = await import("@/lib/availability/availability-service");

    await expect(
      queryProviderAvailability({
        startTime: "invalid-start-time",
      })
    ).rejects.toThrow("Invalid startTime");

    await expect(
      queryProviderAvailability({
        endTime: new Date("invalid-end-time"),
      })
    ).rejects.toThrow("Invalid endTime");

    expect(selectMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("queryProviderAvailability 在 endTime 早于 startTime 时抛出明确错误且不访问数据库", async () => {
    const selectMock = vi.fn(() => createThenableQuery([]));
    const executeMock = vi.fn(async () => []);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: executeMock,
      },
    }));

    const { queryProviderAvailability } = await import("@/lib/availability/availability-service");

    await expect(
      queryProviderAvailability({
        startTime: new Date("2026-04-13T09:00:00.000Z"),
        endTime: new Date("2026-04-13T07:00:00.000Z"),
      })
    ).rejects.toThrow("Invalid time range");

    expect(selectMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
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

    const queryText = normalizeSql(executeMock.mock.calls[0]?.[0]);
    const finalizedRequestsSql = extractFinalizedRequestsSql(queryText);
    expect(finalizedRequestsSql).toMatch(/where .*status_?code.*is not null/);
    expect(queryText).toContain("group by");
    expect(queryText).toContain("percentile_cont(0.95)");
    expect(queryText).toContain("row_number() over");
  });

  it("queryProviderAvailability 在 bucketSizeMinutes 为 Infinity 时回退到自动分桶", async () => {
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
      bucketSizeMinutes: Number.POSITIVE_INFINITY,
    });

    const query = sqlToQuery(executeMock.mock.calls[0]?.[0]);

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(result.bucketSizeMinutes).toBe(5);
    expect(query.params).toContain(300);
    expect(query.params).not.toContain(Number.POSITIVE_INFINITY);
  });

  it("queryProviderAvailability 会排除进行中请求(statusCode=null 且 durationMs=null)", async () => {
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
    await queryProviderAvailability({
      startTime: new Date("2026-04-13T07:00:00.000Z"),
      endTime: new Date("2026-04-13T09:00:00.000Z"),
      bucketSizeMinutes: 60,
    });

    const finalizedRequestsSql = extractFinalizedRequestsSql(
      normalizeSql(executeMock.mock.calls[0]?.[0])
    );
    expect(finalizedRequestsSql).toMatch(/where .*status_?code.*is not null/);
  });

  it("queryProviderAvailability 会保留 Gemini passthrough 终态(statusCode!=null 且 durationMs=null)", async () => {
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
    await queryProviderAvailability({
      startTime: new Date("2026-04-13T07:00:00.000Z"),
      endTime: new Date("2026-04-13T09:00:00.000Z"),
      bucketSizeMinutes: 60,
    });

    const finalizedRequestsSql = extractFinalizedRequestsSql(
      normalizeSql(executeMock.mock.calls[0]?.[0])
    );
    expect(finalizedRequestsSql).not.toMatch(/where .*duration_?ms.*is not null/);
  });

  it("queryProviderAvailability 当前不会把中间持久化状态(statusCode=null 且 durationMs!=null)误算为 red", async () => {
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
    await queryProviderAvailability({
      startTime: new Date("2026-04-13T07:00:00.000Z"),
      endTime: new Date("2026-04-13T09:00:00.000Z"),
      bucketSizeMinutes: 60,
    });

    const queryText = normalizeSql(executeMock.mock.calls[0]?.[0]);
    const finalizedRequestsSql = extractFinalizedRequestsSql(queryText);

    expect(finalizedRequestsSql).toMatch(/where .*status_?code.*is not null/);
    expect(queryText).toMatch(
      /count\(\*\) filter \(where .*status_?code.*< 200 .*or .*status_?code.*>= 400\)/
    );
  });

  it("queryProviderAvailability 在 maxBuckets 为 Infinity 时仍使用默认桶上限", async () => {
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
    await queryProviderAvailability({
      startTime: new Date("2026-04-13T07:00:00.000Z"),
      endTime: new Date("2026-04-13T09:00:00.000Z"),
      bucketSizeMinutes: 60,
      maxBuckets: Number.POSITIVE_INFINITY,
    });

    const query = sqlToQuery(executeMock.mock.calls[0]?.[0]);
    const queryText = normalizeSql(executeMock.mock.calls[0]?.[0]);

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(queryText).toContain("row_number() over");
    expect(queryText).toContain("where rn <=");
    expect(query.params.at(-1)).toBe(100);
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

    const queryText = normalizeSql(executeMock.mock.calls[0]?.[0]);
    expect(queryText).toMatch(/where .*status_?code.*is not null/);
    expect(queryText).toContain("count(*) filter");
    expect(queryText).toContain("max(");
  });
});
