import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const insertState = vi.hoisted(() => ({
  pendingIds: new Set<number>(),
  failedIds: new Set<number>(),
  flushCalls: 0,
  onFlush: null as null | (() => void),
}));

vi.mock("@/repository/message-insert-buffer", () => ({
  hasBufferedMessageRequestInserts: () => insertState.pendingIds.size > 0,
  hasFailedMessageRequestInserts: () => insertState.failedIds.size > 0,
  isMessageRequestInsertPending: (id: number) => insertState.pendingIds.has(id),
  takeFailedMessageRequestInsert: (id: number) => insertState.failedIds.delete(id),
  flushMessageRequestInserts: vi.fn(async () => {
    insertState.flushCalls += 1;
    insertState.onFlush?.();
  }),
  stopMessageRequestInsertBuffer: vi.fn(() => null),
}));

const executedIdLists: number[][] = [];
const executeMock = vi.fn(
  async (query: { toQuery: (config: unknown) => { params: unknown[] } }) => {
    const { params } = query.toQuery({
      escapeName: (name: string) => `"${name}"`,
      escapeParam: (index: number) => `$${index}`,
      escapeString: (value: string) => `'${value}'`,
      paramStartIndex: { value: 1 },
    });
    const ids = Array.from(
      new Set(params.filter((value): value is number => typeof value === "number" && value >= 100))
    );
    executedIdLists.push(ids);
    return ids.map((id) => ({ id }));
  }
);

vi.mock("@/drizzle/db", () => ({
  db: { execute: vi.fn(), select: () => ({ from: () => ({ where: async () => [] }) }) },
  getMessageWriterDb: () => ({ execute: executeMock }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("message write buffer with buffered inserts", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    executedIdLists.length = 0;
    executeMock.mockClear();
    insertState.pendingIds.clear();
    insertState.failedIds.clear();
    insertState.flushCalls = 0;
    insertState.onFlush = null;
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";
    process.env.MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS = "60000";
    process.env.MESSAGE_REQUEST_ASYNC_BATCH_SIZE = "1000";
    process.env.MESSAGE_REQUEST_ASYNC_MAX_PENDING = "1000";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("flushes pending inserts first and holds updates whose insert has not committed", async () => {
    const writeBuffer = await import("@/repository/message-write-buffer");
    insertState.pendingIds.add(101);

    writeBuffer.enqueueMessageRequestUpdate(100, { durationMs: 1 });
    writeBuffer.enqueueMessageRequestUpdate(101, { durationMs: 2 });
    await writeBuffer.flushMessageRequestWriteBuffer();

    expect(insertState.flushCalls).toBe(1);
    expect(executedIdLists).toEqual([[100]]);

    insertState.pendingIds.clear();
    await writeBuffer.flushMessageRequestWriteBuffer();
    expect(executedIdLists).toEqual([[100], [101]]);
  });

  it("writes updates once the insert flush commits their rows", async () => {
    const writeBuffer = await import("@/repository/message-write-buffer");
    insertState.pendingIds.add(102);
    insertState.onFlush = () => insertState.pendingIds.delete(102);

    writeBuffer.enqueueMessageRequestUpdate(102, { durationMs: 3 });
    await writeBuffer.flushMessageRequestWriteBuffer();

    expect(executedIdLists).toEqual([[102]]);
  });

  it("rejects durable updates for rows whose buffered insert failed", async () => {
    const writeBuffer = await import("@/repository/message-write-buffer");
    insertState.pendingIds.add(103);

    const durable = writeBuffer.enqueueMessageRequestUpdateDurably(103, {
      statusCode: 200,
      durationMs: 10,
    });
    await writeBuffer.flushMessageRequestWriteBuffer();
    expect(executedIdLists).toEqual([]);

    insertState.pendingIds.delete(103);
    insertState.failedIds.add(103);
    insertState.pendingIds.add(999); // keep the insert flush path active
    await writeBuffer.flushMessageRequestWriteBuffer();

    await expect(durable).rejects.toThrow("message_request insert failed for id 103");
    expect(executedIdLists).toEqual([]);
  });
});
