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

  const executeMock = vi.fn(async () => []);

  beforeEach(() => {
    vi.resetModules();
    executeMock.mockClear();

    process.env.NODE_ENV = "test";
    process.env.DSN = "postgres://postgres:postgres@localhost:5432/claude_code_hub_test";
    process.env.MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS = "60000";
    process.env.MESSAGE_REQUEST_ASYNC_BATCH_SIZE = "1000";
    process.env.MESSAGE_REQUEST_ASYNC_MAX_PENDING = "1000";

    vi.doMock("@/drizzle/db", () => ({
      db: {
        execute: executeMock,
        // 避免 tests/setup.ts 的 afterAll 清理逻辑因 mock 缺失 select 而报错
        select: () => ({
          from: () => ({
            where: async () => [],
          }),
        }),
      },
    }));
  });

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  it("sync 模式下不应入队/写库", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "sync";

    const { enqueueMessageRequestUpdate, flushMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );

    enqueueMessageRequestUpdate(1, { durationMs: 123 });
    await flushMessageRequestWriteBuffer();

    expect(executeMock).not.toHaveBeenCalled();
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

    const raced = await Promise.race([
      stopPromise.then(() => "stopped"),
      Promise.resolve("pending"),
    ]);
    expect(raced).toBe("pending");

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

  it("队列溢出时应优先丢弃非终态更新（尽量保留 durationMs）", async () => {
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";
    process.env.MESSAGE_REQUEST_ASYNC_MAX_PENDING = "100";

    const { enqueueMessageRequestUpdate, stopMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );

    enqueueMessageRequestUpdate(1001, { statusCode: 200 }); // 非终态（无 durationMs）
    for (let i = 0; i < 100; i++) {
      enqueueMessageRequestUpdate(2000 + i, { durationMs: i });
    }

    await stopMessageRequestWriteBuffer();

    expect(executeMock).toHaveBeenCalledTimes(1);

    const query = executeMock.mock.calls[0]?.[0];
    const built = toSqlText(query);

    expect(built.params).toContain(2000);
    expect(built.params).toContain(2099);
    expect(built.params).not.toContain(1001);
  });
});
