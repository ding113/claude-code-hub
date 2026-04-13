import { beforeEach, describe, expect, it, vi } from "vitest";

function sqlToString(sqlObj: unknown): string {
  const visited = new Set<unknown>();

  const walk = (node: unknown): string => {
    if (!node || visited.has(node)) return "";
    visited.add(node);

    if (typeof node === "string") return node;

    if (typeof node === "object") {
      const anyNode = node as {
        value?: unknown;
        queryChunks?: unknown;
      };

      if (Array.isArray(anyNode)) {
        return anyNode.map(walk).join("");
      }

      if (anyNode.value) {
        if (Array.isArray(anyNode.value)) {
          return anyNode.value.map(String).join("");
        }
        return String(anyNode.value);
      }

      if (anyNode.queryChunks) {
        return walk(anyNode.queryChunks);
      }
    }

    return "";
  };

  return walk(sqlObj);
}

function createThenableQuery<T>(result: T, whereArgs?: unknown[]) {
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
  query.where = vi.fn((arg: unknown) => {
    whereArgs?.push(arg);
    return query;
  });
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(() => query);

  return query;
}

function mockLogger() {
  vi.doMock("@/lib/logger", () => ({
    logger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    },
  }));
}

describe("availability-service", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("queryProviderAvailability 只统计已获得最终结果的请求", async () => {
    const requestWhereArgs: unknown[] = [];
    const selectQueue = [
      createThenableQuery([
        {
          id: 1,
          name: "Provider A",
          providerType: "claude",
          enabled: true,
        },
      ]),
      createThenableQuery(
        [
          {
            id: 100,
            providerId: 1,
            statusCode: null,
            durationMs: null,
            errorMessage: null,
            createdAt: new Date("2026-04-13T08:00:00.000Z"),
          },
          {
            id: 101,
            providerId: 1,
            statusCode: 200,
            durationMs: 120,
            errorMessage: null,
            createdAt: new Date("2026-04-13T08:01:00.000Z"),
          },
          {
            id: 102,
            providerId: 1,
            statusCode: 500,
            durationMs: 240,
            errorMessage: "HTTP 500",
            createdAt: new Date("2026-04-13T08:02:00.000Z"),
          },
        ],
        requestWhereArgs
      ),
    ];

    const fallbackQuery = createThenableQuery<unknown[]>([]);
    const selectMock = vi.fn(() => selectQueue.shift() ?? fallbackQuery);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
      },
    }));
    mockLogger();

    const { queryProviderAvailability } = await import("@/lib/availability/availability-service");
    const result = await queryProviderAvailability({
      startTime: new Date("2026-04-13T07:00:00.000Z"),
      endTime: new Date("2026-04-13T09:00:00.000Z"),
      bucketSizeMinutes: 60,
    });

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]).toMatchObject({
      providerId: 1,
      totalRequests: 2,
      currentAvailability: 0.5,
      successRate: 0.5,
      currentStatus: "green",
    });
    expect(result.providers[0]?.timeBuckets).toHaveLength(1);
    expect(result.providers[0]?.timeBuckets[0]).toMatchObject({
      totalRequests: 2,
      greenCount: 1,
      redCount: 1,
      availabilityScore: 0.5,
    });

    expect(requestWhereArgs).toHaveLength(1);
    const whereSql = sqlToString(requestWhereArgs[0]).toLowerCase();
    expect(whereSql).toContain("is not null");
  });

  it("getCurrentProviderStatus 只统计已获得最终结果的请求", async () => {
    const requestWhereArgs: unknown[] = [];
    const selectQueue = [
      createThenableQuery([
        {
          id: 1,
          name: "Provider A",
        },
      ]),
      createThenableQuery(
        [
          {
            providerId: 1,
            statusCode: null,
            durationMs: null,
            createdAt: new Date("2026-04-13T08:03:00.000Z"),
          },
          {
            providerId: 1,
            statusCode: 503,
            durationMs: 300,
            createdAt: new Date("2026-04-13T08:02:00.000Z"),
          },
          {
            providerId: 1,
            statusCode: 200,
            durationMs: 120,
            createdAt: new Date("2026-04-13T08:01:00.000Z"),
          },
        ],
        requestWhereArgs
      ),
    ];

    const fallbackQuery = createThenableQuery<unknown[]>([]);
    const selectMock = vi.fn(() => selectQueue.shift() ?? fallbackQuery);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
      },
    }));
    mockLogger();

    const { getCurrentProviderStatus } = await import("@/lib/availability/availability-service");
    const result = await getCurrentProviderStatus();

    expect(selectMock).toHaveBeenCalledTimes(2);
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

    expect(requestWhereArgs).toHaveLength(1);
    const whereSql = sqlToString(requestWhereArgs[0]).toLowerCase();
    expect(whereSql).toContain("is not null");
  });
});
