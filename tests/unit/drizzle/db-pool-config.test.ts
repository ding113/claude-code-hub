import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EnvSnapshot = Partial<Record<string, string | undefined>>;

interface MockSqlClient {
  end: ReturnType<typeof vi.fn>;
  unsafe: ReturnType<typeof vi.fn>;
  begin: ReturnType<typeof vi.fn>;
}

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

describe("drizzle/db 连接池配置", () => {
  const envKeys = [
    "NODE_ENV",
    "DSN",
    "DB_POOL_MAX",
    "DB_POOL_IDLE_TIMEOUT",
    "DB_POOL_CONNECT_TIMEOUT",
    "DB_STATEMENT_TIMEOUT_MS",
    "DB_LOCK_TIMEOUT_MS",
    "MESSAGE_REQUEST_WRITE_MODE",
  ];

  const clients: MockSqlClient[] = [];
  const postgresMock = vi.fn(() => {
    const client: MockSqlClient = {
      end: vi.fn(async () => {}),
      unsafe: vi.fn(),
      begin: vi.fn(),
    };
    clients.push(client);
    return client;
  });
  const drizzleMock = vi.fn((client: MockSqlClient) => ({ client }));

  const originalEnv = snapshotEnv(envKeys);

  beforeEach(() => {
    vi.resetModules();
    clients.length = 0;
    postgresMock.mockClear();
    drizzleMock.mockClear();

    process.env.DSN = "postgres://postgres:postgres@localhost:5432/claude_code_hub_test";
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";
    delete process.env.DB_POOL_MAX;
    delete process.env.DB_POOL_IDLE_TIMEOUT;
    delete process.env.DB_POOL_CONNECT_TIMEOUT;
    delete process.env.DB_STATEMENT_TIMEOUT_MS;
    delete process.env.DB_LOCK_TIMEOUT_MS;

    vi.doMock("postgres", () => ({ default: postgresMock }));
    vi.doMock("drizzle-orm/postgres-js", () => ({
      drizzle: drizzleMock,
    }));
  });

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  it("生产环境把默认总预算 20 lazy 拆为 data=15、control=4、writer=1", async () => {
    process.env.NODE_ENV = "production";

    const { getDb, getMessageWriterDb, runWithDataDbScope } = await import("@/drizzle/db");

    expect(postgresMock).not.toHaveBeenCalled();

    const controlDb = getDb();
    const writerDb = getMessageWriterDb();
    const dataDb = runWithDataDbScope(() => getDb());

    expect(controlDb).not.toBe(writerDb);
    expect(controlDb).not.toBe(dataDb);
    expect(writerDb).not.toBe(dataDb);
    expect(postgresMock).toHaveBeenCalledTimes(3);

    const options = postgresMock.mock.calls.map((call) => call[1]);
    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          max: 15,
          connection: expect.objectContaining({
            application_name: "claude-code-hub:data",
            statement_timeout: 90_000,
            lock_timeout: 5_000,
          }),
        }),
        expect.objectContaining({
          max: 4,
          connection: expect.objectContaining({ application_name: "claude-code-hub:control" }),
        }),
        expect.objectContaining({
          max: 1,
          connection: expect.objectContaining({ application_name: "claude-code-hub:writer" }),
        }),
      ])
    );
    expect(options.reduce((sum, option) => sum + option.max, 0)).toBe(20);

    getDb();
    getMessageWriterDb();
    runWithDataDbScope(() => getDb());
    expect(postgresMock).toHaveBeenCalledTimes(3);
  });

  it("开发和测试环境把默认总预算 10 拆为 data=7、control=2、writer=1", async () => {
    process.env.NODE_ENV = "development";

    const { getDb, getMessageWriterDb, runWithDataDbScope } = await import("@/drizzle/db");
    getDb();
    getMessageWriterDb();
    runWithDataDbScope(() => getDb());

    const maxima = postgresMock.mock.calls.map((call) => call[1].max).sort((a, b) => a - b);
    expect(maxima).toEqual([1, 2, 7]);
    expect(maxima.reduce((sum, value) => sum + value, 0)).toBe(10);
  });

  it("自定义总预算仍只创建合计不超过 DB_POOL_MAX 的物理 pool", async () => {
    process.env.NODE_ENV = "production";
    process.env.DB_POOL_MAX = "24";
    process.env.DB_POOL_IDLE_TIMEOUT = "30";
    process.env.DB_POOL_CONNECT_TIMEOUT = "5";
    process.env.DB_STATEMENT_TIMEOUT_MS = "45000";
    process.env.DB_LOCK_TIMEOUT_MS = "1500";

    const { getDb, getMessageWriterDb, runWithDataDbScope } = await import("@/drizzle/db");
    getDb();
    getMessageWriterDb();
    runWithDataDbScope(() => getDb());

    const options = postgresMock.mock.calls.map((call) => call[1]);
    expect(options.reduce((sum, option) => sum + option.max, 0)).toBe(24);
    for (const option of options) {
      expect(option).toEqual(
        expect.objectContaining({
          idle_timeout: 30,
          connect_timeout: 5,
          connection: expect.objectContaining({
            statement_timeout: 45_000,
            lock_timeout: 1_500,
          }),
        })
      );
    }
  });

  it("shutdown 只关闭已经 lazy 创建的物理 pool，且每条只关闭一次", async () => {
    process.env.NODE_ENV = "production";

    const { closeDbPools, getDb, getMessageWriterDb, runWithDataDbScope } = await import(
      "@/drizzle/db"
    );
    getDb();
    getMessageWriterDb();
    runWithDataDbScope(() => getDb());

    await closeDbPools();
    await closeDbPools();

    expect(clients).toHaveLength(3);
    for (const client of clients) {
      expect(client.end).toHaveBeenCalledTimes(1);
      expect(client.end).toHaveBeenCalledWith({ timeout: 5 });
    }
  });

  it("同步重入 shutdown 复用同一 pending Promise 且每个 pool 只关闭一次", async () => {
    process.env.NODE_ENV = "production";

    const { closeDbPools, getDb, getMessageWriterDb, runWithDataDbScope } = await import(
      "@/drizzle/db"
    );
    getDb();
    getMessageWriterDb();
    runWithDataDbScope(() => getDb());

    let resolveClose!: () => void;
    const closeBarrier = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    for (const client of clients) {
      client.end.mockImplementation(() => closeBarrier);
    }

    let reentrantClose: Promise<void> | undefined;
    clients[0].end.mockImplementationOnce(() => {
      reentrantClose = closeDbPools();
      return closeBarrier;
    });

    let outerSettled = false;
    let reentrantSettled = false;
    const outerClose = closeDbPools();
    try {
      reentrantClose?.then(
        () => {
          reentrantSettled = true;
        },
        () => {
          reentrantSettled = true;
        }
      );
      outerClose.then(
        () => {
          outerSettled = true;
        },
        () => {
          outerSettled = true;
        }
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect.soft(reentrantClose).toBeDefined();
      expect.soft(outerClose).toBe(reentrantClose);
      expect.soft(clients.map((client) => client.end.mock.calls.length)).toEqual([1, 1, 1]);
      expect.soft(outerSettled).toBe(false);
      expect.soft(reentrantSettled).toBe(false);
    } finally {
      resolveClose();
      await Promise.all([outerClose, reentrantClose]);
    }
  });

  it("pool closing 和 closed 状态都拒绝创建快照外连接", async () => {
    process.env.NODE_ENV = "production";

    const { closeDbPools, getDb, getMessageWriterDb, runWithDataDbScope } = await import(
      "@/drizzle/db"
    );
    getDb();
    getMessageWriterDb();
    runWithDataDbScope(() => getDb());

    let resolveClose!: () => void;
    const closeBarrier = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    for (const client of clients) {
      client.end.mockImplementation(() => closeBarrier);
    }

    const closing = closeDbPools();

    expect(() => getDb()).toThrow("Database pools are closing");
    expect(() => getMessageWriterDb()).toThrow("Database pools are closing");
    expect(() => runWithDataDbScope(() => getDb())).toThrow("Database pools are closing");
    expect(postgresMock).toHaveBeenCalledTimes(3);

    resolveClose();
    await closing;

    expect(() => getDb()).toThrow("Database pools are closed");
    expect(() => getMessageWriterDb()).toThrow("Database pools are closed");
    expect(postgresMock).toHaveBeenCalledTimes(3);
    await closeDbPools();

    for (const client of clients) {
      expect(client.end).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    { total: 1, expectedPhysicalPools: 1 },
    { total: 2, expectedPhysicalPools: 2 },
  ])("极小总预算 $total 可共享 lane 且物理连接上限不超预算", async ({
    total,
    expectedPhysicalPools,
  }) => {
    process.env.NODE_ENV = "production";
    process.env.DB_POOL_MAX = String(total);

    const { getDb, getMessageWriterDb, runWithDataDbScope } = await import("@/drizzle/db");
    const controlDb = getDb();
    const writerDb = getMessageWriterDb();
    const dataDb = runWithDataDbScope(() => getDb());

    expect(controlDb).toBeDefined();
    expect(writerDb).toBeDefined();
    expect(dataDb).toBeDefined();
    expect(postgresMock).toHaveBeenCalledTimes(expectedPhysicalPools);

    const maxima = postgresMock.mock.calls.map((call) => call[1].max);
    expect(maxima.every((value) => value >= 1)).toBe(true);
    expect(maxima.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(total);

    vi.resetModules();
    clients.length = 0;
    postgresMock.mockClear();
    drizzleMock.mockClear();
  });
});
