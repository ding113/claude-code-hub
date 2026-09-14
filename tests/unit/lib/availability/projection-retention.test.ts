import type { SQL } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function sqlToString(sqlObject: unknown): string {
  return (sqlObject as SQL)
    .toQuery({
      escapeName: (name: string) => `"${name}"`,
      escapeParam: (num: number) => `$${num}`,
      escapeString: (value: string) => `'${value}'`,
      casing: new CasingCache(),
      paramStartIndex: { value: 1 },
    })
    .sql.replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  withAdvisoryLock: vi.fn(),
  env: { PROJECTION_OUTBOX_RETENTION_DAYS: 3, PROJECTION_APPLIED_RETENTION_DAYS: 7 },
}));

vi.mock("@/drizzle/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("@/lib/migrate", () => ({ withAdvisoryLock: mocks.withAdvisoryLock }));
vi.mock("@/lib/config/env.schema", () => ({ getEnvConfig: () => mocks.env }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  __test__,
  APPLIED_RETENTION_CUTOFF_META_KEY,
  PROJECTION_RETENTION_BATCH_SIZE,
  PROJECTION_RETENTION_INTERVAL_MS,
  runProjectionRetention,
  startProjectionRetentionScheduler,
  stopProjectionRetentionScheduler,
} from "@/lib/availability/projection-retention";

function rows(count: number): unknown[] {
  return Array.from({ length: count }, () => ({ "?column?": 1 }));
}

describe("projection retention", () => {
  beforeEach(() => {
    __test__.resetState();
    mocks.execute.mockReset();
    mocks.withAdvisoryLock.mockReset();
    mocks.withAdvisoryLock.mockImplementation(
      async (_name: string, fn: () => Promise<unknown>) => ({
        ran: true,
        result: await fn(),
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes expired outbox and applied rows in batches until a short batch", async () => {
    const outboxResults = [rows(PROJECTION_RETENTION_BATCH_SIZE), rows(12)];
    const appliedResults = [rows(3)];
    mocks.execute.mockImplementation(async (query: unknown) => {
      const text = sqlToString(query);
      if (text.includes("delete from outbox_events")) return outboxResults.shift() ?? [];
      if (text.includes("delete from proj_applied_requests")) return appliedResults.shift() ?? [];
      return [];
    });

    const result = await runProjectionRetention(new Date("2026-06-10T00:00:00.000Z"));

    expect(result).toEqual({
      outboxDeleted: PROJECTION_RETENTION_BATCH_SIZE + 12,
      appliedDeleted: 3,
    });
    const texts = mocks.execute.mock.calls.map((call) => sqlToString(call[0]));
    const outboxDeletes = texts.filter((t) => t.includes("delete from outbox_events"));
    expect(outboxDeletes).toHaveLength(2);
    expect(outboxDeletes[0]).toContain("published_at is not null");
    expect(outboxDeletes[0]).toContain("for update skip locked");
    expect(outboxDeletes[0]).toContain("with boundary as");
    expect(texts.filter((t) => t.includes("delete from proj_applied_requests"))).toHaveLength(1);
  });

  it("uses the configured retention windows and records the applied cutoff before deleting", async () => {
    const params: unknown[][] = [];
    const order: string[] = [];
    mocks.execute.mockImplementation(async (query: unknown) => {
      const compiled = (query as SQL).toQuery({
        escapeName: (name: string) => `"${name}"`,
        escapeParam: (num: number) => `$${num}`,
        escapeString: (value: string) => `'${value}'`,
        casing: new CasingCache(),
        paramStartIndex: { value: 1 },
      });
      params.push(compiled.params);
      const text = compiled.sql.toLowerCase();
      if (text.includes("delete from outbox_events")) order.push("outbox");
      else if (text.includes("insert into projection_meta")) order.push("meta");
      else if (text.includes("delete from proj_applied_requests")) order.push("applied");
      return [];
    });

    await runProjectionRetention(new Date("2026-06-10T00:00:00.000Z"));

    expect(order).toEqual(["outbox", "meta", "applied"]);
    expect(params[0]).toContain("2026-06-07T00:00:00.000Z");
    expect(params[1]).toEqual([APPLIED_RETENTION_CUTOFF_META_KEY, "2026-06-03T00:00:00.000Z"]);
    expect(params[2]).toContain("2026-06-03T00:00:00.000Z");
  });

  it("returns null when another instance holds the lock", async () => {
    mocks.withAdvisoryLock.mockResolvedValue({ ran: false });

    await expect(runProjectionRetention()).resolves.toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("schedules the first run after startup, repeats every interval, and stops cleanly", async () => {
    vi.useFakeTimers();
    mocks.execute.mockResolvedValue([]);

    startProjectionRetentionScheduler();
    startProjectionRetentionScheduler();
    expect(mocks.withAdvisoryLock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(__test__.FIRST_RUN_DELAY_MS);
    expect(mocks.withAdvisoryLock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(PROJECTION_RETENTION_INTERVAL_MS);
    expect(mocks.withAdvisoryLock).toHaveBeenCalledTimes(2);

    await stopProjectionRetentionScheduler();
    await vi.advanceTimersByTimeAsync(PROJECTION_RETENTION_INTERVAL_MS * 2);
    expect(mocks.withAdvisoryLock).toHaveBeenCalledTimes(2);
  });

  it("keeps scheduling after a failed run", async () => {
    vi.useFakeTimers();
    mocks.withAdvisoryLock.mockRejectedValueOnce(new Error("lock connection failed"));
    mocks.execute.mockResolvedValue([]);

    startProjectionRetentionScheduler();
    await vi.advanceTimersByTimeAsync(__test__.FIRST_RUN_DELAY_MS);
    await vi.advanceTimersByTimeAsync(PROJECTION_RETENTION_INTERVAL_MS);

    expect(mocks.withAdvisoryLock).toHaveBeenCalledTimes(2);
    await stopProjectionRetentionScheduler();
  });

  it("stops deleting further batches once stop is requested", async () => {
    let calls = 0;
    mocks.execute.mockImplementation(async (query: unknown) => {
      const text = sqlToString(query);
      if (text.includes("delete from outbox_events")) {
        calls += 1;
        if (calls === 1) {
          void stopProjectionRetentionScheduler();
        }
        return rows(PROJECTION_RETENTION_BATCH_SIZE);
      }
      return [];
    });

    const result = await runProjectionRetention();

    expect(calls).toBe(1);
    expect(result?.appliedDeleted).toBe(0);
  });
});
