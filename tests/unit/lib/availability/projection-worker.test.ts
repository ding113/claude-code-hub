import type { SQL } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";
import { beforeEach, describe, expect, it, vi } from "vitest";

function sqlToString(sqlObject: unknown): string {
  return (sqlObject as SQL)
    .toQuery({
      escapeName: (name: string) => `"${name}"`,
      escapeParam: (num: number, _value: unknown) => `$${num}`,
      escapeString: (value: string) => `'${value}'`,
      casing: new CasingCache(),
      paramStartIndex: { value: 1 },
    })
    .sql.replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

describe("availability projection-worker", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete (globalThis as { __CCH_AVAIL_PROJ_WORKER__?: unknown }).__CCH_AVAIL_PROJ_WORKER__;
  });

  it("asPayload 解析 object / JSON 字符串 / 非法输入", async () => {
    vi.doMock("@/drizzle/db", () => ({
      db: { execute: vi.fn(), transaction: vi.fn() },
    }));
    vi.doMock("@/lib/migrate", () => ({
      withAdvisoryLock: vi.fn(async (_n: string, fn: () => Promise<unknown>) => ({
        ran: true,
        result: await fn(),
      })),
    }));
    vi.doMock("@/lib/logger", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    const { asPayload } = await import("@/lib/availability/projection-worker");

    expect(asPayload({ request_id: 1, provider_id: 2 })).toEqual({
      request_id: 1,
      provider_id: 2,
    });
    expect(asPayload('{"request_id":3}')).toEqual({ request_id: 3 });
    expect(asPayload("{not-json")).toEqual({});
    expect(asPayload(null)).toEqual({});
    expect(asPayload(42)).toEqual({});
  });

  it("processBatch 对新鲜事件写入 1m 桶并重算 avail_current", async () => {
    const executeMock = vi.fn(async (query: unknown) => {
      const text = sqlToString(query);
      if (text.includes("for update skip locked")) {
        return [
          {
            id: 10,
            event_id: "11111111-1111-1111-1111-111111111111",
            payload: {
              request_id: 100,
              provider_id: 7,
              outcome: "success",
              occurred_at: "2026-04-13T08:03:12.000Z",
              duration_ms: 120,
            },
          },
        ];
      }
      if (text.includes("insert into proj_applied_requests")) {
        return [{ request_id: 100 }];
      }
      return [];
    });
    const transactionMock = vi.fn(async (fn: (tx: { execute: typeof executeMock }) => Promise<number>) =>
      fn({ execute: executeMock })
    );

    vi.doMock("@/drizzle/db", () => ({
      db: { execute: executeMock, transaction: transactionMock },
    }));
    vi.doMock("@/lib/migrate", () => ({
      withAdvisoryLock: vi.fn(async (_n: string, fn: () => Promise<unknown>) => ({
        ran: true,
        result: await fn(),
      })),
    }));
    vi.doMock("@/lib/logger", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    const { processBatch } = await import("@/lib/availability/projection-worker");
    const applied = await processBatch();
    expect(applied).toBe(1);

    const texts = executeMock.mock.calls.map((c) => sqlToString(c[0]));
    expect(texts.some((t) => t.includes("insert into avail_bucket_1m"))).toBe(true);
    expect(texts.some((t) => t.includes("insert into avail_current"))).toBe(true);
    expect(texts.some((t) => t.includes("15 * interval '1 minute'"))).toBe(true);
    expect(texts.some((t) => t.includes("update outbox_events") && t.includes("published_at"))).toBe(
      true
    );
  });

  it("processBatch 对重复 request 不重复计数", async () => {
    const executeMock = vi.fn(async (query: unknown) => {
      const text = sqlToString(query);
      if (text.includes("for update skip locked")) {
        return [
          {
            id: 11,
            event_id: "22222222-2222-2222-2222-222222222222",
            payload: {
              request_id: 100,
              provider_id: 7,
              outcome: "success",
              occurred_at: "2026-04-13T08:03:12.000Z",
              duration_ms: 120,
            },
          },
        ];
      }
      if (text.includes("insert into proj_applied_requests")) {
        return []; // ON CONFLICT DO NOTHING
      }
      return [];
    });
    const transactionMock = vi.fn(async (fn: (tx: { execute: typeof executeMock }) => Promise<number>) =>
      fn({ execute: executeMock })
    );

    vi.doMock("@/drizzle/db", () => ({
      db: { execute: executeMock, transaction: transactionMock },
    }));
    vi.doMock("@/lib/migrate", () => ({
      withAdvisoryLock: vi.fn(async (_n: string, fn: () => Promise<unknown>) => ({
        ran: true,
        result: await fn(),
      })),
    }));
    vi.doMock("@/lib/logger", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    const { processBatch } = await import("@/lib/availability/projection-worker");
    const applied = await processBatch();
    expect(applied).toBe(0);

    const texts = executeMock.mock.calls.map((c) => sqlToString(c[0]));
    expect(texts.some((t) => t.includes("insert into avail_bucket_1m"))).toBe(false);
    expect(texts.some((t) => t.includes("update outbox_events"))).toBe(true);
  });

  it("processBatch 将非法 payload 标记 published + last_error", async () => {
    const executeMock = vi.fn(async (query: unknown) => {
      const text = sqlToString(query);
      if (text.includes("for update skip locked")) {
        return [
          {
            id: 12,
            event_id: "33333333-3333-3333-3333-333333333333",
            payload: { outcome: "success" },
          },
        ];
      }
      return [];
    });
    const transactionMock = vi.fn(async (fn: (tx: { execute: typeof executeMock }) => Promise<number>) =>
      fn({ execute: executeMock })
    );

    vi.doMock("@/drizzle/db", () => ({
      db: { execute: executeMock, transaction: transactionMock },
    }));
    vi.doMock("@/lib/migrate", () => ({
      withAdvisoryLock: vi.fn(async (_n: string, fn: () => Promise<unknown>) => ({
        ran: true,
        result: await fn(),
      })),
    }));
    vi.doMock("@/lib/logger", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    const { processBatch } = await import("@/lib/availability/projection-worker");
    expect(await processBatch()).toBe(0);

    const texts = executeMock.mock.calls.map((c) => sqlToString(c[0]));
    expect(texts.some((t) => t.includes("last_error") && t.includes("invalid payload"))).toBe(true);
  });

  it("bootstrapBackfill 在 backfill_done 已存在时为 no-op", async () => {
    const executeMock = vi.fn(async () => [{ key: "backfill_done" }]);
    const withAdvisoryLock = vi.fn();

    vi.doMock("@/drizzle/db", () => ({
      db: { execute: executeMock, transaction: vi.fn() },
    }));
    vi.doMock("@/lib/migrate", () => ({ withAdvisoryLock }));
    vi.doMock("@/lib/logger", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    const { __test__ } = await import("@/lib/availability/projection-worker");
    await __test__.bootstrapBackfill();

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(withAdvisoryLock).not.toHaveBeenCalled();
  });
});
