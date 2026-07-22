import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EnvSnapshot = Partial<Record<string, string | undefined>>;

function snapshotEnv(keys: string[]): EnvSnapshot {
  const snapshot: EnvSnapshot = {};
  for (const key of keys) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot: EnvSnapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function toSqlText(query: { toQuery: (config: any) => { sql: string; params: unknown[] } }) {
  return query.toQuery({
    escapeName: (name: string) => `"${name}"`,
    escapeParam: (index: number) => `$${index}`,
    escapeString: (value: string) => `'${value}'`,
    paramStartIndex: { value: 1 },
  });
}

function successfulRowsForQuery(query: {
  toQuery: (config: any) => { sql: string; params: unknown[] };
}): Array<{ id: number }> {
  const { params } = toSqlText(query);
  const numericParams = params.filter((value): value is number => typeof value === "number");
  return Array.from(new Set(numericParams), (id) => ({ id }));
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("message_request 异步批量写入", () => {
  const envKeys = [
    "NODE_ENV",
    "DSN",
    "MESSAGE_REQUEST_WRITE_MODE",
    "MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS",
    "MESSAGE_REQUEST_ASYNC_BATCH_SIZE",
    "MESSAGE_REQUEST_ASYNC_MAX_PENDING",
  ];
  const originalEnv = snapshotEnv(envKeys);

  const executeMock = vi.fn(async () => [] as Array<{ id: number }>);
  const defaultExecuteMock = vi.fn(async () => [] as Array<{ id: number }>);
  const getMessageWriterDbMock = vi.fn();
  const loggerWarnMock = vi.fn();
  const loggerErrorMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    executeMock.mockReset();
    executeMock.mockImplementation(async (query) => successfulRowsForQuery(query));
    defaultExecuteMock.mockReset();
    defaultExecuteMock.mockImplementation(async (query) => successfulRowsForQuery(query));
    getMessageWriterDbMock.mockReset();
    getMessageWriterDbMock.mockReturnValue({ execute: executeMock });
    loggerWarnMock.mockReset();
    loggerErrorMock.mockReset();

    process.env.NODE_ENV = "test";
    process.env.DSN = "postgres://postgres:postgres@localhost:5432/claude_code_hub_test";
    process.env.MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS = "60000";
    process.env.MESSAGE_REQUEST_ASYNC_BATCH_SIZE = "1000";
    process.env.MESSAGE_REQUEST_ASYNC_MAX_PENDING = "1000";

    vi.doMock("@/drizzle/db", () => ({
      db: {
        execute: defaultExecuteMock,
        // 避免 tests/setup.ts 的 afterAll 清理逻辑因 mock 缺失 select 而报错
        select: () => ({
          from: () => ({
            where: async () => [],
          }),
        }),
      },
      getMessageWriterDb: getMessageWriterDbMock,
    }));
    vi.doMock("@/lib/logger", () => ({
      logger: {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: loggerWarnMock,
        error: loggerErrorMock,
      },
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreEnv(originalEnv);
  });

  it("sync 模式下不应入队/写库", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "sync";

    const { enqueueMessageRequestUpdate, flushMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );

    enqueueMessageRequestUpdate(1, { durationMs: 123 });
    await flushMessageRequestWriteBuffer();

    expect(getMessageWriterDbMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
    expect(defaultExecuteMock).not.toHaveBeenCalled();
  });

  it("async 模式下应合并同一 id 的多次更新并批量写入", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const {
      enqueueMessageRequestUpdate,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    enqueueMessageRequestUpdate(42, { durationMs: 100 });
    enqueueMessageRequestUpdate(42, { statusCode: 200, ttfbMs: 10 });

    await flushMessageRequestWriteBuffer();
    await stopMessageRequestWriteBuffer();

    expect(executeMock).toHaveBeenCalledTimes(1);

    const query = executeMock.mock.calls[0]?.[0];
    const built = toSqlText(query);

    expect(built.sql).toContain("UPDATE message_request");
    expect(built.sql).toContain("duration_ms");
    expect(built.sql).toContain("status_code");
    expect(built.sql).toContain("ttfb_ms");
    expect(built.sql).toContain("updated_at");
    expect(built.sql).toContain("deleted_at IS NULL");
    expect(built.sql).not.toContain("RETURNING id");
  });

  it("batch SQL 应显式使用 writer DB handle，而不是默认 ALS DB", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const {
      enqueueMessageRequestUpdate,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    enqueueMessageRequestUpdate(43, { durationMs: 101 });
    await flushMessageRequestWriteBuffer();
    await stopMessageRequestWriteBuffer();

    expect(getMessageWriterDbMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(defaultExecuteMock).not.toHaveBeenCalled();
  });

  it("普通 enqueue 立即返回，但 durable enqueue 应等待批量 SQL 成功", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const deferred = createDeferred<unknown[]>();
    executeMock.mockImplementationOnce(async () => deferred.promise);

    const {
      enqueueMessageRequestUpdate,
      enqueueMessageRequestUpdateDurably,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    expect(enqueueMessageRequestUpdate(1, { durationMs: 10 })).toBeUndefined();
    const durablePromise = enqueueMessageRequestUpdateDurably(2, { statusCode: 200 });
    const flushPromise = flushMessageRequestWriteBuffer();

    expect(executeMock).toHaveBeenCalledTimes(1);
    const built = toSqlText(executeMock.mock.calls[0]?.[0]);
    expect(built.sql).toContain("RETURNING id");
    let settled = false;
    void durablePromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    deferred.resolve([{ id: 2 }]);
    await flushPromise;
    await durablePromise;
    await stopMessageRequestWriteBuffer();
  });

  it("mixed batch 只对 durable id 应用 status_code 终态 fence", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const deferred = createDeferred<unknown[]>();
    executeMock.mockImplementationOnce(async () => deferred.promise);

    const {
      enqueueMessageRequestUpdate,
      enqueueMessageRequestUpdateDurably,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    enqueueMessageRequestUpdate(51001, { durationMs: 17 });
    const durablePromise = enqueueMessageRequestUpdateDurably(52002, { statusCode: 503 });
    const flushPromise = flushMessageRequestWriteBuffer();

    const built = toSqlText(executeMock.mock.calls[0]?.[0]);
    const ordinaryIdOccurrences = built.params.filter((value) => value === 51001).length;
    const durableIdOccurrences = built.params.filter((value) => value === 52002).length;

    expect(built.sql).toMatch(/"?status_code"? IS NULL/);
    expect(built.sql).toContain("RETURNING id");
    expect(durableIdOccurrences).toBeGreaterThan(ordinaryIdOccurrences);

    deferred.resolve([{ id: 51001 }, { id: 52002 }]);
    await flushPromise;
    await expect(durablePromise).resolves.toBe(true);
    await stopMessageRequestWriteBuffer();
  });

  it("多个 durable 终态应由同一次 batch flush 共同确认", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const deferred = createDeferred<unknown[]>();
    executeMock.mockImplementationOnce(async () => deferred.promise);

    const {
      enqueueMessageRequestUpdateDurably,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    const first = enqueueMessageRequestUpdateDurably(11, { statusCode: 200 });
    const second = enqueueMessageRequestUpdateDurably(12, { statusCode: 500 });
    const flushPromise = flushMessageRequestWriteBuffer();

    expect(executeMock).toHaveBeenCalledTimes(1);
    const built = toSqlText(executeMock.mock.calls[0]?.[0]);
    expect(built.params).toContain(11);
    expect(built.params).toContain(12);

    deferred.resolve([{ id: 11 }, { id: 12 }]);
    await flushPromise;
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    await stopMessageRequestWriteBuffer();
  });

  it("同一 id 的后续 durable contender 不得覆盖首个 terminal owner", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const deferred = createDeferred<unknown[]>();
    executeMock.mockImplementationOnce(async () => deferred.promise);

    const {
      enqueueMessageRequestUpdateDurably,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");
    const ownerCallback = vi.fn();
    const contenderCallback = vi.fn();

    const owner = enqueueMessageRequestUpdateDurably(
      13,
      { statusCode: 200, errorMessage: "owner" },
      { onCommitted: ownerCallback }
    );
    const contender = enqueueMessageRequestUpdateDurably(
      13,
      { statusCode: 499, errorMessage: "contender" },
      { onCommitted: contenderCallback }
    );
    const flushPromise = flushMessageRequestWriteBuffer();

    deferred.resolve([{ id: 13 }]);
    await flushPromise;
    await expect(owner).resolves.toBe(true);
    await expect(contender).resolves.toBe(false);

    const built = toSqlText(executeMock.mock.calls[0]?.[0]);
    expect(built.params).toContain("owner");
    expect(built.params).not.toContain("contender");
    expect(ownerCallback).toHaveBeenCalledOnce();
    expect(contenderCallback).not.toHaveBeenCalled();
    expect(executeMock).toHaveBeenCalledTimes(1);
    await stopMessageRequestWriteBuffer();
  });

  it("DB flush 失败时不得确认 durable waiter，重试成功后才确认", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    executeMock.mockRejectedValueOnce(new Error("db down"));
    executeMock.mockResolvedValueOnce([{ id: 21 }]);

    const {
      enqueueMessageRequestUpdateDurably,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    const durablePromise = enqueueMessageRequestUpdateDurably(21, { statusCode: 200 });
    await flushMessageRequestWriteBuffer();
    let settled = false;
    void durablePromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    await flushMessageRequestWriteBuffer();
    await expect(durablePromise).resolves.toBe(true);
    expect(executeMock).toHaveBeenCalledTimes(2);
    await stopMessageRequestWriteBuffer();
  });

  it("队列全部由 durable 终态保护时，应拒绝新的 durable id 而不丢旧终态", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";
    process.env.MESSAGE_REQUEST_ASYNC_MAX_PENDING = "100";

    const {
      enqueueMessageRequestUpdateDurably,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    const protectedPromises = Array.from({ length: 100 }, (_, index) =>
      enqueueMessageRequestUpdateDurably(1000 + index, { statusCode: 200 })
    );

    await expect(enqueueMessageRequestUpdateDurably(9999, { statusCode: 500 })).rejects.toThrow(
      "durable message_request queue is full"
    );

    await flushMessageRequestWriteBuffer();
    await expect(Promise.all(protectedPromises)).resolves.toHaveLength(100);
    const built = toSqlText(executeMock.mock.calls[0]?.[0]);
    expect(built.params).toContain(1000);
    expect(built.params).toContain(1099);
    expect(built.params).not.toContain(9999);
    await stopMessageRequestWriteBuffer();
  });

  it("durable ack timeout 后应清理 waiter，并允许同 id 后续重新提交", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const {
      enqueueMessageRequestUpdateDurably,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    await expect(
      enqueueMessageRequestUpdateDurably(31, { statusCode: 200 }, { timeoutMs: 10 })
    ).rejects.toThrow("durable message_request acknowledgement timed out");

    const retry = enqueueMessageRequestUpdateDurably(31, { statusCode: 200 });
    await flushMessageRequestWriteBuffer();
    await expect(retry).resolves.toBe(true);
    await stopMessageRequestWriteBuffer();
  });

  it("pending durable ack 超时后应删除整代 patch，后续提交不得继承 stale 字段", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const {
      enqueueMessageRequestUpdateDurably,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    vi.useFakeTimers();
    const staleGeneration = enqueueMessageRequestUpdateDurably(
      311,
      { statusCode: 200, errorMessage: "stale-primary-generation" },
      { timeoutMs: 10 }
    );
    const staleGenerationResult = staleGeneration.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    await expect(staleGenerationResult).resolves.toEqual(
      expect.objectContaining({
        message: "durable message_request acknowledgement timed out",
      })
    );

    const retry = enqueueMessageRequestUpdateDurably(311, { statusCode: 502 });
    await flushMessageRequestWriteBuffer();
    await expect(retry).resolves.toBe(true);

    const built = toSqlText(executeMock.mock.calls[0]?.[0]);
    expect(built.params).not.toContain("stale-primary-generation");
    await stopMessageRequestWriteBuffer();
  });

  it("in-flight durable ack 超时后应允许同 id 重新提交且只确认新 batch", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const firstExecute = createDeferred<unknown[]>();
    executeMock.mockImplementationOnce(async () => firstExecute.promise);
    executeMock.mockResolvedValueOnce([{ id: 32 }]);

    const {
      enqueueMessageRequestUpdateDurably,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    const first = enqueueMessageRequestUpdateDurably(32, { statusCode: 500 }, { timeoutMs: 10 });
    const flushPromise = flushMessageRequestWriteBuffer();
    await expect(first).rejects.toThrow("durable message_request acknowledgement timed out");

    const retry = enqueueMessageRequestUpdateDurably(32, { statusCode: 200 });
    firstExecute.resolve([]);

    await flushPromise;
    await expect(retry).resolves.toBe(true);
    expect(executeMock).toHaveBeenCalledTimes(2);
    await stopMessageRequestWriteBuffer();
  });

  it("in-flight durable generation 超时且写入失败后不得作为普通 patch 重排", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const firstExecute = createDeferred<unknown[]>();
    executeMock.mockImplementationOnce(async () => firstExecute.promise);

    const {
      enqueueMessageRequestUpdateDurably,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    vi.useFakeTimers();
    const first = enqueueMessageRequestUpdateDurably(
      321,
      { statusCode: 200, errorMessage: "stale-primary" },
      { timeoutMs: 10 }
    );
    const firstResult = first.catch((error: unknown) => error);
    const flushPromise = flushMessageRequestWriteBuffer();

    await vi.advanceTimersByTimeAsync(10);
    await expect(firstResult).resolves.toEqual(
      expect.objectContaining({
        message: "durable message_request acknowledgement timed out",
      })
    );
    firstExecute.reject(new Error("db down after timeout"));
    await flushPromise;

    await flushMessageRequestWriteBuffer();
    expect(executeMock).toHaveBeenCalledTimes(1);
    await stopMessageRequestWriteBuffer();
  });

  it("durable ack 超时后 late primary 真正提交时仍只发布一次 commit receipt", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const releasePrimary = createDeferred<void>();
    executeMock.mockImplementationOnce(async () => {
      await releasePrimary.promise;
      return [{ id: 323 }];
    });
    const onCommitted = vi.fn();

    const {
      enqueueMessageRequestUpdateDurably,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    vi.useFakeTimers();
    const primary = enqueueMessageRequestUpdateDurably(
      323,
      { statusCode: 200 },
      { timeoutMs: 10, onCommitted }
    );
    const primaryResult = primary.catch((error: unknown) => error);
    const flushPromise = flushMessageRequestWriteBuffer();

    await vi.advanceTimersByTimeAsync(10);
    await expect(primaryResult).resolves.toEqual(
      expect.objectContaining({
        message: "durable message_request acknowledgement timed out",
      })
    );
    expect(onCommitted).not.toHaveBeenCalled();

    releasePrimary.resolve();
    await flushPromise;

    expect(onCommitted).toHaveBeenCalledTimes(1);
    await stopMessageRequestWriteBuffer();
  });

  it("commit receipt 回调失败不得让已提交的 durable flush 失败", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const {
      enqueueMessageRequestUpdateDurably,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    const durable = enqueueMessageRequestUpdateDurably(
      324,
      { statusCode: 200 },
      {
        onCommitted: () => {
          throw new Error("rollup callback failed");
        },
      }
    );

    await expect(flushMessageRequestWriteBuffer()).resolves.toBeUndefined();
    await expect(durable).resolves.toBe(true);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "[MessageRequestWriteBuffer] Durable commit callback failed",
      expect.objectContaining({
        error: "rollup callback failed",
        messageRequestId: 324,
      })
    );
    await stopMessageRequestWriteBuffer();
  });

  it("stop 应等待已提交终态的异步 commit callback 完成", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";
    const callback = createDeferred<void>();
    const {
      enqueueMessageRequestUpdateDurably,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    const durable = enqueueMessageRequestUpdateDurably(
      325,
      { statusCode: 200 },
      { onCommitted: () => callback.promise }
    );
    await flushMessageRequestWriteBuffer();
    await durable;

    let stopped = false;
    const stop = stopMessageRequestWriteBuffer().then(() => {
      stopped = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(stopped).toBe(false);

    callback.resolve();
    await stop;
    expect(stopped).toBe(true);
  });

  it("fallback CAS 先写入后，late durable primary 不得覆盖既有终态", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    let persistedStatus: number | null = null;
    const releasePrimary = createDeferred<void>();
    const onCommitted = vi.fn();
    executeMock.mockImplementationOnce(async (query) => {
      await releasePrimary.promise;
      const built = toSqlText(query);
      const hasTerminalFence = /"?status_code"? IS NULL/.test(built.sql);
      if (hasTerminalFence && persistedStatus !== null) {
        return [];
      }
      persistedStatus = 200;
      return [{ id: 322 }];
    });

    const {
      enqueueMessageRequestUpdateDurably,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    vi.useFakeTimers();
    const primary = enqueueMessageRequestUpdateDurably(
      322,
      { statusCode: 200 },
      { timeoutMs: 10, onCommitted }
    );
    const primaryResult = primary.catch((error: unknown) => error);
    const flushPromise = flushMessageRequestWriteBuffer();

    await vi.advanceTimersByTimeAsync(10);
    await expect(primaryResult).resolves.toEqual(
      expect.objectContaining({
        message: "durable message_request acknowledgement timed out",
      })
    );
    persistedStatus = 502;
    releasePrimary.resolve();

    await flushPromise;
    expect(persistedStatus).toBe(502);
    expect(onCommitted).not.toHaveBeenCalled();
    await stopMessageRequestWriteBuffer();
  });

  it("durable batch 成功但目标行未更新时不得虚假确认", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";
    executeMock.mockResolvedValueOnce([]);

    const {
      enqueueMessageRequestUpdateDurably,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    const durablePromise = enqueueMessageRequestUpdateDurably(33, { statusCode: 200 });
    await flushMessageRequestWriteBuffer();

    await expect(durablePromise).rejects.toThrow(
      "durable message_request update did not persist id 33"
    );
    await stopMessageRequestWriteBuffer();
  });

  it.each([
    { databaseOutcome: "成功", shouldReject: false },
    { databaseOutcome: "失败", shouldReject: true },
  ])("executor 首次同步重入 stop 时应共享同一 Promise, 并等待 DB $databaseOutcome", async ({
    shouldReject,
  }) => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const databaseBarrier = createDeferred<Array<{ id: number }>>();
    const databaseError = new Error("db unavailable");
    let reentrantStopPromise: Promise<void> | undefined;
    let stopMessageRequestWriteBuffer!: () => Promise<void>;

    executeMock.mockImplementation((query) => {
      if (!reentrantStopPromise) {
        reentrantStopPromise = stopMessageRequestWriteBuffer();
        return databaseBarrier.promise;
      }
      return shouldReject
        ? Promise.reject(databaseError)
        : Promise.resolve(successfulRowsForQuery(query));
    });

    const messageWriteBuffer = await import("@/repository/message-write-buffer");
    stopMessageRequestWriteBuffer = messageWriteBuffer.stopMessageRequestWriteBuffer;
    messageWriteBuffer.enqueueMessageRequestUpdate(42, { durationMs: 100 });

    const outerStopPromise = stopMessageRequestWriteBuffer();
    const reentrantPromise = reentrantStopPromise;
    if (!reentrantPromise) {
      throw new Error("executor did not synchronously re-enter stop");
    }
    const samePromise = outerStopPromise === reentrantPromise;
    let outerSettled = false;
    let reentrantSettled = false;
    void outerStopPromise.then(
      () => {
        outerSettled = true;
      },
      () => {
        outerSettled = true;
      }
    );
    void reentrantPromise.then(
      () => {
        reentrantSettled = true;
      },
      () => {
        reentrantSettled = true;
      }
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const settlementsBeforeRelease = [outerSettled, reentrantSettled];

    if (shouldReject) {
      databaseBarrier.reject(databaseError);
    } else {
      databaseBarrier.resolve([]);
    }
    const stopResults = await Promise.allSettled([outerStopPromise, reentrantPromise]);

    expect(settlementsBeforeRelease).toEqual([false, false]);
    if (shouldReject) {
      const shutdownError = "message_request writer shutdown persistence failed";
      expect(stopResults).toEqual([
        { status: "rejected", reason: expect.objectContaining({ message: shutdownError }) },
        { status: "rejected", reason: expect.objectContaining({ message: shutdownError }) },
      ]);
    } else {
      expect(stopResults).toEqual([
        { status: "fulfilled", value: undefined },
        { status: "fulfilled", value: undefined },
      ]);
    }
    expect(samePromise).toBe(true);
  });

  it("stop 无法刷写剩余终态时所有调用都应持续拒绝同一错误", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";
    executeMock.mockRejectedValue(new Error("db unavailable"));

    const { enqueueMessageRequestUpdateDurably, stopMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );

    const durablePromise = enqueueMessageRequestUpdateDurably(41, { statusCode: 500 });
    const durableResult = durablePromise.catch((error: unknown) => error);
    const shutdownError = "message_request writer shutdown persistence failed";
    const stopResults = await Promise.allSettled([
      stopMessageRequestWriteBuffer(),
      stopMessageRequestWriteBuffer(),
    ]);

    expect(stopResults).toEqual([
      { status: "rejected", reason: expect.objectContaining({ message: shutdownError }) },
      { status: "rejected", reason: expect.objectContaining({ message: shutdownError }) },
    ]);

    await expect(durableResult).resolves.toEqual(
      expect.objectContaining({ message: shutdownError })
    );
    await expect(stopMessageRequestWriteBuffer()).rejects.toThrow(shutdownError);
  });

  it("应对 costUsd/providerChain 做显式类型转换（numeric/jsonb）", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const { enqueueMessageRequestUpdate, stopMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );

    enqueueMessageRequestUpdate(7, {
      costUsd: "0.000123",
      providerChain: [{ id: 1, name: "p1" }],
    });

    await stopMessageRequestWriteBuffer();

    expect(executeMock).toHaveBeenCalledTimes(1);

    const query = executeMock.mock.calls[0]?.[0];
    const built = toSqlText(query);

    expect(built.sql).toContain("::numeric");
    expect(built.sql).toContain("::jsonb");
  });

  it("stop 应等待 in-flight flush 完成", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const deferred = createDeferred<unknown[]>();
    executeMock.mockImplementationOnce(async () => deferred.promise);

    const { enqueueMessageRequestUpdate, stopMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );

    enqueueMessageRequestUpdate(1, { durationMs: 123 });

    const stopPromise = stopMessageRequestWriteBuffer();

    expect(executeMock).toHaveBeenCalledTimes(1);

    let settled = false;
    void stopPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    deferred.resolve([]);
    await stopPromise;
  });

  it("flush 进行中 enqueue 的更新应最终落库", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const firstExecute = createDeferred<unknown[]>();
    executeMock.mockImplementationOnce(async () => firstExecute.promise);
    executeMock.mockImplementationOnce(async () => []);

    const {
      enqueueMessageRequestUpdate,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    enqueueMessageRequestUpdate(42, { durationMs: 100 });

    const flushPromise = flushMessageRequestWriteBuffer();
    expect(executeMock).toHaveBeenCalledTimes(1);

    // 在第一次写入尚未完成时，追加同一请求的后续 patch
    enqueueMessageRequestUpdate(42, { statusCode: 200 });

    firstExecute.resolve([]);

    await flushPromise;
    await stopMessageRequestWriteBuffer();

    expect(executeMock).toHaveBeenCalledTimes(2);

    const secondQuery = executeMock.mock.calls[1]?.[0];
    const built = toSqlText(secondQuery);
    expect(built.sql).toContain("status_code");
  });

  it("DB 写入失败重试时不应覆盖更晚的 patch", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const firstExecute = createDeferred<unknown[]>();
    executeMock.mockImplementationOnce(async () => firstExecute.promise);
    executeMock.mockImplementationOnce(async () => []);

    const {
      enqueueMessageRequestUpdate,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    enqueueMessageRequestUpdate(7, { durationMs: 100 });

    const flushPromise = flushMessageRequestWriteBuffer();
    expect(executeMock).toHaveBeenCalledTimes(1);

    // 在第一次 flush 的 in-flight 期间写入“更晚”的字段
    enqueueMessageRequestUpdate(7, { statusCode: 500 });

    firstExecute.reject(new Error("db down"));
    await flushPromise;

    // 触发下一次 flush：应同时包含 duration/statusCode
    await flushMessageRequestWriteBuffer();
    await stopMessageRequestWriteBuffer();

    expect(executeMock).toHaveBeenCalledTimes(2);

    const secondQuery = executeMock.mock.calls[1]?.[0];
    const built = toSqlText(secondQuery);
    expect(built.sql).toContain("duration_ms");
    expect(built.sql).toContain("status_code");
  });

  it("队列溢出时应优先保留带 statusCode 的终态 patch", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";
    process.env.MESSAGE_REQUEST_ASYNC_MAX_PENDING = "100";

    const { enqueueMessageRequestUpdate, stopMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );

    enqueueMessageRequestUpdate(1001, { statusCode: 200 }); // Gemini passthrough 等 statusCode-only 终态
    for (let i = 0; i < 100; i++) {
      enqueueMessageRequestUpdate(2000 + i, { durationMs: i });
    }

    await stopMessageRequestWriteBuffer();

    expect(executeMock).toHaveBeenCalledTimes(1);

    const query = executeMock.mock.calls[0]?.[0];
    const built = toSqlText(query);

    expect(built.params).toContain(1001);
    expect(built.sql).toContain("status_code");
    expect(built.params).not.toContain(2000);
    expect(built.params).toContain(2099);
  });

  it("同 id patch 升级为终态后，overflow 索引应保留升级后的高优先级记录", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";
    process.env.MESSAGE_REQUEST_ASYNC_MAX_PENDING = "100";

    const { enqueueMessageRequestUpdate, stopMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );

    enqueueMessageRequestUpdate(3001, { model: "metadata-only" });
    enqueueMessageRequestUpdate(3002, { model: "evict-me" });
    for (let i = 0; i < 98; i++) {
      enqueueMessageRequestUpdate(4000 + i, { durationMs: i });
    }

    enqueueMessageRequestUpdate(3001, { statusCode: 200 });
    enqueueMessageRequestUpdate(4999, { durationMs: 999 });
    await stopMessageRequestWriteBuffer();

    const built = toSqlText(executeMock.mock.calls[0]?.[0]);
    expect(built.params).toContain(3001);
    expect(built.params).not.toContain(3002);
    expect(built.params).toContain(4999);
  });

  it("DB 失败重排后，overflow 索引仍应淘汰最低优先级 ordinary patch", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";
    process.env.MESSAGE_REQUEST_ASYNC_MAX_PENDING = "100";

    const firstExecute = createDeferred<unknown[]>();
    executeMock.mockImplementationOnce(async () => firstExecute.promise);

    const {
      enqueueMessageRequestUpdate,
      flushMessageRequestWriteBuffer,
      stopMessageRequestWriteBuffer,
    } = await import("@/repository/message-write-buffer");

    enqueueMessageRequestUpdate(5001, { model: "old-low-priority" });
    const flushPromise = flushMessageRequestWriteBuffer();

    for (let i = 0; i < 100; i++) {
      enqueueMessageRequestUpdate(6000 + i, { durationMs: i });
    }
    firstExecute.reject(new Error("db down"));
    await flushPromise;
    await stopMessageRequestWriteBuffer();

    const retried = toSqlText(executeMock.mock.calls[1]?.[0]);
    expect(retried.params).not.toContain(5001);
    expect(retried.params).toContain(6000);
    expect(retried.params).toContain(6099);
  });

  it("burst overflow 应限频为单条聚合告警", async () => {
    vi.useFakeTimers();
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";
    process.env.MESSAGE_REQUEST_ASYNC_MAX_PENDING = "100";

    const { enqueueMessageRequestUpdate, stopMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );

    for (let i = 0; i < 250; i++) {
      enqueueMessageRequestUpdate(7000 + i, { durationMs: i });
    }

    expect(loggerWarnMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      "[MessageRequestWriteBuffer] Pending queue overflow, dropping updates",
      expect.objectContaining({
        maxPending: 100,
        droppedCount: 150,
        currentPending: 100,
      })
    );

    await stopMessageRequestWriteBuffer();
  });

  it("costUsd 走纯替换语义（CASE id ... ::numeric，不累加）", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";

    const { enqueueMessageRequestUpdate, stopMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );

    enqueueMessageRequestUpdate(11, { costUsd: "0.000123" });
    await stopMessageRequestWriteBuffer();

    const built = toSqlText(executeMock.mock.calls[0]?.[0]);
    // 缓冲只承载非 hedge 的替换型 cost 写入（hedge 赢家/输家都走直接写）。
    expect(built.sql).toContain('"cost_usd" = CASE id');
    expect(built.sql).toContain("::numeric");
    expect(built.sql).not.toContain("COALESCE");
  });
});

describe("mergePatch（替换合并语义）", () => {
  it("非 undefined 的 incoming 字段覆盖 base", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";
    process.env.DSN = "postgres://postgres:postgres@localhost:5432/claude_code_hub_test";
    vi.doMock("@/drizzle/db", () => ({
      db: {
        execute: vi.fn(async () => []),
        select: () => ({ from: () => ({ where: async () => [] }) }),
      },
    }));
    const { mergePatch } = await import("@/repository/message-write-buffer");

    const merged = mergePatch(
      { costUsd: "0.1", statusCode: 200, durationMs: 100 },
      { statusCode: 500 }
    );

    expect(merged.statusCode).toBe(500); // incoming wins
    expect(merged.costUsd).toBe("0.1"); // untouched (incoming undefined)
    expect(merged.durationMs).toBe(100); // untouched
  });
});
