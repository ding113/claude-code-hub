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
});
