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

describe("drizzle/db 连接池配置", () => {
  const envKeys = [
    "NODE_ENV",
    "DSN",
    "DB_POOL_MAX",
    "DB_POOL_IDLE_TIMEOUT",
    "DB_POOL_CONNECT_TIMEOUT",
    "MESSAGE_REQUEST_WRITE_MODE",
  ];

  const postgresMock = vi.fn();
  const drizzleMock = vi.fn(() => ({ __db: true }));

  const originalEnv = snapshotEnv(envKeys);

  beforeEach(() => {
    vi.resetModules();
    postgresMock.mockReset();
    drizzleMock.mockReset();

    // 确保每个用例有一致的基础环境
    process.env.DSN = "postgres://postgres:postgres@localhost:5432/claude_code_hub_test";
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";
    delete process.env.DB_POOL_MAX;
    delete process.env.DB_POOL_IDLE_TIMEOUT;
    delete process.env.DB_POOL_CONNECT_TIMEOUT;

    vi.doMock("postgres", () => ({ default: postgresMock }));
    vi.doMock("drizzle-orm/postgres-js", () => ({
      drizzle: drizzleMock,
    }));
  });

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  it("生产环境默认 max=20、idle_timeout=20、connect_timeout=10", async () => {
    process.env.NODE_ENV = "production";

    const { getDb } = await import("@/drizzle/db");
    getDb();

    expect(postgresMock).toHaveBeenCalledWith(
      process.env.DSN,
      expect.objectContaining({
        max: 20,
        idle_timeout: 20,
        connect_timeout: 10,
      })
    );
  });

  it("开发环境默认 max=10", async () => {
    process.env.NODE_ENV = "development";

    const { getDb } = await import("@/drizzle/db");
    getDb();

    expect(postgresMock).toHaveBeenCalledWith(
      process.env.DSN,
      expect.objectContaining({
        max: 10,
      })
    );
  });

  it("支持通过 env 覆盖连接池参数", async () => {
    process.env.NODE_ENV = "production";
    process.env.DB_POOL_MAX = "50";
    process.env.DB_POOL_IDLE_TIMEOUT = "30";
    process.env.DB_POOL_CONNECT_TIMEOUT = "5";

    const { getDb } = await import("@/drizzle/db");
    getDb();

    expect(postgresMock).toHaveBeenCalledWith(
      process.env.DSN,
      expect.objectContaining({
        max: 50,
        idle_timeout: 30,
        connect_timeout: 5,
      })
    );
  });
});
