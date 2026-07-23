import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoutingTraceV1 } from "@/types/routing-trace";

const mocks = vi.hoisted(() => {
  const hash = new Map<string, string>();
  const redis = {
    status: "ready",
    eval: vi.fn(),
    hlen: vi.fn(),
    hscan: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  };
  const returning = vi.fn();
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const getMessageWriterDb = vi.fn(() => ({ update }));
  return {
    getMessageWriterDb,
    hash,
    redis,
    returning,
    set,
    update,
    where,
  };
});

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: vi.fn(() => mocks.redis),
}));

vi.mock("@/drizzle/db", () => ({
  getMessageWriterDb: mocks.getMessageWriterDb,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  acknowledgeRoutingTraceOutbox,
  replayRoutingTraceOutbox,
  stageRoutingTraceOutbox,
  startRoutingTraceOutboxReplayScheduler,
  stopRoutingTraceOutboxReplayScheduler,
} from "@/repository/routing-trace-outbox";

function createTrace(updatedAt: number): RoutingTraceV1 {
  return {
    version: 1,
    mode: "discovery",
    startedAt: 1_000,
    updatedAt,
    discoveryEnabled: true,
    eligible: true,
    events: [
      {
        type: "binding_finalized",
        at: updatedAt,
        elapsedMs: updatedAt - 1_000,
        bindingAction: "create",
        outcome: "updated",
      },
    ],
  };
}

function toSqlText(value: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(value);
}

describe("routing trace outbox", () => {
  beforeEach(async () => {
    await stopRoutingTraceOutboxReplayScheduler();
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.hash.clear();
    mocks.redis.status = "ready";
    mocks.returning.mockResolvedValue([{ id: 41 }]);
    mocks.redis.eval.mockImplementation(
      async (script: string, _keyCount: number, _key: string, ...args: string[]) => {
        if (script.includes("HSET")) {
          const [field, incomingRevisionRaw, payload] = args;
          if (!field || !incomingRevisionRaw || !payload) return 0;
          const current = mocks.hash.get(field);
          if (current) {
            const currentRevision = Number(
              (JSON.parse(current) as { traceUpdatedAt?: unknown }).traceUpdatedAt
            );
            const incomingRevision = Number(incomingRevisionRaw);
            if (currentRevision > incomingRevision) return 0;
            if (currentRevision === incomingRevision && current !== payload) return 0;
          }
          mocks.hash.set(field, payload);
          return 1;
        }
        if (script.includes("HDEL")) {
          const [field, payload] = args;
          if (!field || !payload || mocks.hash.get(field) !== payload) return 0;
          mocks.hash.delete(field);
          return 1;
        }
        throw new Error("unexpected Lua script");
      }
    );
    mocks.redis.hscan.mockImplementation(
      async (_key: string, cursor: string, _countKeyword: string, count: number) => {
        const entries = Array.from(mocks.hash.entries());
        const start = Number(cursor);
        const page = entries.slice(start, start + count);
        const nextCursor =
          start + page.length >= entries.length ? "0" : String(start + page.length);
        return [nextCursor, page.flat()];
      }
    );
    mocks.redis.hlen.mockImplementation(async () => mocks.hash.size);
  });

  afterEach(async () => {
    await stopRoutingTraceOutboxReplayScheduler();
    vi.useRealTimers();
  });

  it("stages the normalized trace before persistence without an expiry", async () => {
    const receipt = await stageRoutingTraceOutbox(41, createTrace(1_100));

    expect(receipt).toEqual({ field: "41", payload: mocks.hash.get("41") });
    expect(JSON.parse(receipt?.payload ?? "{}")).toMatchObject({
      version: 1,
      requestId: 41,
      traceUpdatedAt: 1_100,
    });
    expect(String(mocks.redis.eval.mock.calls[0]?.[0])).not.toContain("EXPIRE");
  });

  it("does not let an older stage replace a newer recoverable snapshot", async () => {
    const newReceipt = await stageRoutingTraceOutbox(41, createTrace(1_101));

    await expect(stageRoutingTraceOutbox(41, createTrace(1_100))).resolves.toBeNull();
    expect(mocks.hash.get("41")).toBe(newReceipt?.payload);
  });

  it("waits briefly for an initial Redis connection before staging", async () => {
    vi.useFakeTimers();
    mocks.redis.status = "connecting";
    const staged = stageRoutingTraceOutbox(41, createTrace(1_100));

    mocks.redis.status = "ready";
    await vi.advanceTimersByTimeAsync(500);

    await expect(staged).resolves.toEqual({ field: "41", payload: mocks.hash.get("41") });
  });

  it("bounds a stalled Redis stage operation", async () => {
    vi.useFakeTimers();
    mocks.redis.eval.mockImplementationOnce(async () => new Promise(() => {}));
    const staged = stageRoutingTraceOutbox(41, createTrace(1_100));

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(staged).resolves.toBeNull();
  });

  it("acknowledges only the exact staged payload", async () => {
    const oldReceipt = await stageRoutingTraceOutbox(41, createTrace(1_100));
    const newReceipt = await stageRoutingTraceOutbox(41, createTrace(1_101));

    await expect(acknowledgeRoutingTraceOutbox(oldReceipt!)).resolves.toBe(false);
    expect(mocks.hash.get("41")).toBe(newReceipt?.payload);
    await expect(acknowledgeRoutingTraceOutbox(newReceipt!)).resolves.toBe(true);
    expect(mocks.hash.has("41")).toBe(false);
  });

  it("replays a trace monotonically and removes it after database acknowledgement", async () => {
    await stageRoutingTraceOutbox(41, createTrace(1_100));

    const result = await replayRoutingTraceOutbox();

    expect(result).toMatchObject({ replayed: 1, retained: 0, backlog: 0 });
    expect(mocks.hash.has("41")).toBe(false);
    const assignment = mocks.set.mock.calls[0]?.[0] as {
      routingTrace: SQL;
      updatedAt: SQL;
    };
    const built = toSqlText(assignment.routingTrace);
    expect(built.sql).toContain("jsonb_typeof");
    expect(built.sql).toContain("<");
    expect(built.params).toContain(1_100);
  });

  it("retains the staged trace when the database write fails", async () => {
    mocks.returning.mockRejectedValueOnce(new Error("database unavailable"));
    const receipt = await stageRoutingTraceOutbox(41, createTrace(1_100));

    const result = await replayRoutingTraceOutbox();

    expect(result).toMatchObject({ replayed: 0, retained: 1, backlog: 1 });
    expect(mocks.hash.get("41")).toBe(receipt?.payload);
  });

  it("keeps a newer stage when an older replay acknowledgement arrives late", async () => {
    let releaseOldWrite!: (rows: Array<{ id: number }>) => void;
    const oldWrite = new Promise<Array<{ id: number }>>((resolve) => {
      releaseOldWrite = resolve;
    });
    mocks.returning.mockImplementationOnce(async () => oldWrite);
    await stageRoutingTraceOutbox(41, createTrace(1_100));

    const replay = replayRoutingTraceOutbox();
    await vi.waitFor(() => expect(mocks.returning).toHaveBeenCalledOnce());
    const newReceipt = await stageRoutingTraceOutbox(41, createTrace(1_101));
    releaseOldWrite([{ id: 41 }]);
    const oldResult = await replay;

    expect(oldResult.retained).toBe(1);
    expect(mocks.hash.get("41")).toBe(newReceipt?.payload);
    await replayRoutingTraceOutbox();
    expect(mocks.hash.has("41")).toBe(false);
  });

  it("continues a bounded HSCAN cursor across replay cycles", async () => {
    await Promise.all([
      stageRoutingTraceOutbox(41, createTrace(1_100)),
      stageRoutingTraceOutbox(42, createTrace(1_100)),
      stageRoutingTraceOutbox(43, createTrace(1_100)),
    ]);
    mocks.returning.mockRejectedValue(new Error("database unavailable"));

    const first = await replayRoutingTraceOutbox({ limit: 2 });
    const second = await replayRoutingTraceOutbox({ cursor: first.cursor, limit: 2 });

    expect(first).toMatchObject({ scanned: 2, retained: 2, backlog: 3 });
    expect(first.cursor).not.toBe("0");
    expect(second).toMatchObject({ scanned: 1, retained: 1, backlog: 3 });
    expect(second.cursor).toBe("0");
  });

  it("processes an entire HSCAN page when Redis returns more than the COUNT hint", async () => {
    await Promise.all([
      stageRoutingTraceOutbox(41, createTrace(1_100)),
      stageRoutingTraceOutbox(42, createTrace(1_100)),
      stageRoutingTraceOutbox(43, createTrace(1_100)),
    ]);
    mocks.redis.hscan.mockResolvedValueOnce(["0", Array.from(mocks.hash.entries()).flat()]);

    const result = await replayRoutingTraceOutbox({ limit: 2 });

    expect(result).toMatchObject({ scanned: 3, replayed: 3, backlog: 0 });
  });

  it("eventually drains a backlog larger than one replay page", async () => {
    await Promise.all(
      Array.from({ length: 250 }, (_, index) =>
        stageRoutingTraceOutbox(1_000 + index, createTrace(1_100 + index))
      )
    );

    let cursor = "0";
    for (let cycle = 0; cycle < 5 && mocks.hash.size > 0; cycle++) {
      const result = await replayRoutingTraceOutbox({ cursor, limit: 100 });
      cursor = result.cursor;
    }

    expect(mocks.hash.size).toBe(0);
    expect(mocks.returning).toHaveBeenCalledTimes(250);
  });

  it("discards malformed entries without sending them to the database", async () => {
    mocks.hash.set("41", "not-json");

    const result = await replayRoutingTraceOutbox();

    expect(result).toMatchObject({ discarded: 1, retained: 0, backlog: 0 });
    expect(mocks.getMessageWriterDb).not.toHaveBeenCalled();
  });

  it("retries after Redis becomes ready and stops future scheduler ticks", async () => {
    vi.useFakeTimers();
    mocks.redis.status = "connecting";
    await startRoutingTraceOutboxReplayScheduler();
    expect(mocks.redis.hscan).not.toHaveBeenCalled();

    mocks.redis.status = "ready";
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.redis.hscan).toHaveBeenCalledOnce();

    await stopRoutingTraceOutboxReplayScheduler();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.redis.hscan).toHaveBeenCalledOnce();
  });

  it("stops ticks immediately and bounds the join of an in-flight replay", async () => {
    vi.useFakeTimers();
    mocks.redis.hscan.mockImplementationOnce(async () => new Promise(() => {}));
    await startRoutingTraceOutboxReplayScheduler();
    await Promise.resolve();
    expect(mocks.redis.hscan).toHaveBeenCalledOnce();

    await expect(stopRoutingTraceOutboxReplayScheduler({ wait: false })).resolves.toBeUndefined();
    const joined = stopRoutingTraceOutboxReplayScheduler({ wait: true, maxWaitMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(joined).resolves.toBeUndefined();

    // Let the Redis operation's own timeout settle the detached cycle.
    await vi.advanceTimersByTimeAsync(900);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.redis.hscan).toHaveBeenCalledOnce();
  });
});
