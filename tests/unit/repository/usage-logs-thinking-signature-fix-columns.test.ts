import { describe, expect, test, vi } from "vitest";

function createThenableQuery<T>(result: T) {
  const query: any = Promise.resolve(result);

  query.from = vi.fn(() => query);
  query.innerJoin = vi.fn(() => query);
  query.leftJoin = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.offset = vi.fn(() => query);
  query.groupBy = vi.fn(() => query);

  return query;
}

describe("Usage logs：thinkingSignatureFix 审计字段查询", () => {
  test("findUsageLogsBatch 的 select 应包含 thinkingSignatureFixApplied/Reason", async () => {
    vi.resetModules();

    const selectArgs: unknown[] = [];
    const selectMock = vi.fn((selection: unknown) => {
      selectArgs.push(selection);
      return createThenableQuery([]);
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        // 给 tests/setup.ts 的 afterAll 清理逻辑一个可用的 execute
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { findUsageLogsBatch } = await import("@/repository/usage-logs");
    await findUsageLogsBatch({ limit: 1 });

    const selection = selectArgs[0] as Record<string, unknown> | undefined;
    expect(selection).toBeTruthy();
    expect(selection).toHaveProperty("thinkingSignatureFixApplied");
    expect(selection).toHaveProperty("thinkingSignatureFixReason");
  });

  test("findUsageLogsWithDetails 的 logs select 应包含 thinkingSignatureFixApplied/Reason", async () => {
    vi.resetModules();

    const selectArgs: unknown[] = [];
    const selectQueue: any[] = [];

    // 第一次 select：summary/total
    selectQueue.push(
      createThenableQuery([
        {
          totalRows: 0,
          totalRequests: 0,
          totalCost: "0",
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheCreationTokens: 0,
          totalCacheReadTokens: 0,
          totalCacheCreation5mTokens: 0,
          totalCacheCreation1hTokens: 0,
        },
      ])
    );

    // 第二次 select：分页 logs
    selectQueue.push(createThenableQuery([]));

    const fallbackSelect = createThenableQuery<unknown[]>([]);
    const selectMock = vi.fn((selection: unknown) => {
      selectArgs.push(selection);
      return selectQueue.shift() ?? fallbackSelect;
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { findUsageLogsWithDetails } = await import("@/repository/usage-logs");
    await findUsageLogsWithDetails({ page: 1, pageSize: 1 });

    // 约定：第二次 select 为 logs 列表
    const logsSelection = selectArgs[1] as Record<string, unknown> | undefined;
    expect(logsSelection).toBeTruthy();
    expect(logsSelection).toHaveProperty("thinkingSignatureFixApplied");
    expect(logsSelection).toHaveProperty("thinkingSignatureFixReason");
  });
});
