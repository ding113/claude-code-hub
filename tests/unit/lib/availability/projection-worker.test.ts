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
    const transactionMock = vi.fn(
      async (fn: (tx: { execute: typeof executeMock }) => Promise<number>) =>
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
    expect(
      texts.some((t) => t.includes("update outbox_events") && t.includes("published_at"))
    ).toBe(true);
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
    const transactionMock = vi.fn(
      async (fn: (tx: { execute: typeof executeMock }) => Promise<number>) =>
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
    const transactionMock = vi.fn(
      async (fn: (tx: { execute: typeof executeMock }) => Promise<number>) =>
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

describe("availability projection-worker batching and scheduling", () => {
  function mockCommon(executeMock: ReturnType<typeof vi.fn>) {
    const transactionMock = vi.fn(
      async (fn: (tx: { execute: typeof executeMock }) => Promise<number>) =>
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
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    vi.doMock("@/lib/system-settings/proxy-runtime", () => ({
      isHighConcurrencyModeEnabledCached: () => false,
    }));
    vi.doMock("@/lib/availability/projection-retention", () => ({
      APPLIED_RETENTION_CUTOFF_META_KEY: "applied_retention_cutoff",
      startProjectionRetentionScheduler: vi.fn(),
      stopProjectionRetentionScheduler: vi.fn(async () => undefined),
    }));
    return transactionMock;
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    delete (globalThis as { __CCH_AVAIL_PROJ_WORKER__?: unknown }).__CCH_AVAIL_PROJ_WORKER__;
  });

  it("marks applied requests with one multi-row insert and counts in-batch duplicates once", async () => {
    const event = (id: number, requestId: number, providerId: number) => ({
      id,
      event_id: `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`,
      payload: {
        request_id: requestId,
        provider_id: providerId,
        outcome: "success",
        occurred_at: "2026-04-13T08:03:12.000Z",
        duration_ms: 50,
      },
    });
    const executeMock = vi.fn(async (query: unknown) => {
      const text = sqlToString(query);
      if (text.includes("for update skip locked")) {
        // request 200 appears twice; request 300 was already applied by an earlier batch.
        return [event(1, 200, 7), event(2, 200, 7), event(3, 300, 7), event(4, 400, 8)];
      }
      if (text.includes("insert into proj_applied_requests")) {
        return [{ request_id: 200 }, { request_id: "400" }];
      }
      return [];
    });
    mockCommon(executeMock);

    const { processBatch } = await import("@/lib/availability/projection-worker");
    expect(await processBatch()).toBe(2);

    const texts = executeMock.mock.calls.map((c) => sqlToString(c[0]));
    const appliedInserts = texts.filter((t) => t.includes("insert into proj_applied_requests"));
    expect(appliedInserts).toHaveLength(1);
    expect(appliedInserts[0].match(/::uuid\)/g)).toHaveLength(3);

    const bucketInserts = texts.filter((t) => t.includes("insert into avail_bucket_1m"));
    expect(bucketInserts).toHaveLength(2);
    const published = texts.find((t) => t.includes("update outbox_events"));
    expect(published).toContain("$1, $2, $3, $4");
  });

  it("does not issue the applied insert when every claimed payload is invalid", async () => {
    const executeMock = vi.fn(async (query: unknown) => {
      const text = sqlToString(query);
      if (text.includes("for update skip locked")) {
        return [{ id: 9, event_id: "x", payload: { outcome: "success" } }];
      }
      return [];
    });
    mockCommon(executeMock);

    const { processBatch } = await import("@/lib/availability/projection-worker");
    expect(await processBatch()).toBe(0);

    const texts = executeMock.mock.calls.map((c) => sqlToString(c[0]));
    expect(texts.some((t) => t.includes("insert into proj_applied_requests"))).toBe(false);
  });

  it("resolves the next poll delay from the cycle outcome and concurrency mode", async () => {
    mockCommon(vi.fn(async () => []));
    const { resolveNextDelayMs, __test__ } = await import("@/lib/availability/projection-worker");

    expect(resolveNextDelayMs("saturated", false)).toBe(__test__.BUSY_MS);
    expect(resolveNextDelayMs("partial", true)).toBe(__test__.TICK_MS);
    expect(resolveNextDelayMs("empty", false)).toBe(__test__.IDLE_TICK_MS);
    expect(resolveNextDelayMs("empty", true)).toBe(__test__.IDLE_TICK_MS_HIGH_CONCURRENCY);
  });

  it("runCycle reports empty, partial and saturated outcomes", async () => {
    const sizes: number[] = [];
    const executeMock = vi.fn(async (query: unknown) => {
      const text = sqlToString(query);
      if (text.includes("for update skip locked")) {
        const size = sizes.shift() ?? 0;
        return Array.from({ length: size }, (_, i) => ({
          id: i + 1,
          event_id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
          payload: {
            request_id: i + 1,
            provider_id: 1,
            outcome: "success",
            occurred_at: "2026-04-13T08:03:12.000Z",
          },
        }));
      }
      if (text.includes("insert into proj_applied_requests")) {
        const count = (text.match(/::uuid\)/g) ?? []).length;
        return Array.from({ length: count }, (_, i) => ({ request_id: i + 1 }));
      }
      return [];
    });
    mockCommon(executeMock);
    const { __test__ } = await import("@/lib/availability/projection-worker");

    sizes.push(0);
    expect(await __test__.runCycle()).toBe("empty");

    sizes.push(5);
    expect(await __test__.runCycle()).toBe("partial");

    for (let i = 0; i < 20; i++) sizes.push(__test__.BATCH);
    expect(await __test__.runCycle()).toBe("saturated");
  });

  it("start schedules polling with setTimeout and starts retention; stop cancels both", async () => {
    vi.useFakeTimers();
    const executeMock = vi.fn(async (query: unknown) => {
      const text = sqlToString(query);
      if (text.includes("projection_meta")) return [{ key: "backfill_done" }];
      return [];
    });
    mockCommon(executeMock);
    const retention = await import("@/lib/availability/projection-retention");
    const worker = await import("@/lib/availability/projection-worker");

    worker.startAvailabilityProjectionWorker();
    expect(retention.startProjectionRetentionScheduler).toHaveBeenCalledTimes(1);
    expect(worker.getAvailabilityProjectionWorkerStatus()).toMatchObject({
      started: true,
      tickMs: worker.__test__.TICK_MS,
    });

    await vi.advanceTimersByTimeAsync(worker.__test__.TICK_MS);
    const claimsAfterFirstTick = executeMock.mock.calls.filter((c) =>
      sqlToString(c[0]).includes("for update skip locked")
    ).length;
    expect(claimsAfterFirstTick).toBe(1);
    expect(worker.getAvailabilityProjectionWorkerStatus().tickMs).toBe(
      worker.__test__.IDLE_TICK_MS
    );

    await worker.stopAvailabilityProjectionWorker();
    expect(retention.stopProjectionRetentionScheduler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(worker.__test__.IDLE_TICK_MS * 3);
    const claimsAfterStop = executeMock.mock.calls.filter((c) =>
      sqlToString(c[0]).includes("for update skip locked")
    ).length;
    expect(claimsAfterStop).toBe(1);
  });

  it("clamps the one-time backfill start to the applied retention cutoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    const chunkStarts: string[] = [];
    const executeMock = vi.fn(async (query: unknown) => {
      const text = sqlToString(query);
      if (text.includes("select key from projection_meta")) return [];
      if (text.includes("select value from projection_meta")) {
        return [{ value: { cutoff: "2026-05-31T00:00:00.000Z" } }];
      }
      if (text.includes("insert into outbox_events")) {
        const params = (query as SQL).toQuery({
          escapeName: (name: string) => `"${name}"`,
          escapeParam: (num: number) => `$${num}`,
          escapeString: (value: string) => `'${value}'`,
          casing: new CasingCache(),
          paramStartIndex: { value: 1 },
        }).params;
        chunkStarts.push(String(params[0]));
        return [{ n: 0 }];
      }
      return [];
    });
    mockCommon(executeMock);
    const { __test__ } = await import("@/lib/availability/projection-worker");

    await __test__.bootstrapBackfill();

    // 24h window / 6h chunks => 4 chunks starting at the cutoff, not 100 days back.
    expect(chunkStarts).toHaveLength(4);
    expect(chunkStarts[0]).toBe("2026-05-31T00:00:00.000Z");
  });
});
