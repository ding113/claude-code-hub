import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("drizzle/db 数据面作用域", () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    DSN: process.env.DSN,
    DB_POOL_MAX: process.env.DB_POOL_MAX,
  };

  const postgresMock = vi.fn(() => ({
    unsafe: vi.fn(),
    begin: vi.fn(),
    end: vi.fn(async () => {}),
  }));
  const drizzleMock = vi.fn((client: unknown) => ({ client }));

  beforeEach(() => {
    vi.resetModules();
    postgresMock.mockClear();
    drizzleMock.mockClear();
    process.env.NODE_ENV = "production";
    process.env.DSN = "postgres://postgres:postgres@localhost:5432/claude_code_hub_test";
    process.env.DB_POOL_MAX = "20";

    vi.doMock("postgres", () => ({ default: postgresMock }));
    vi.doMock("drizzle-orm/postgres-js", () => ({ drizzle: drizzleMock }));
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("默认使用 control pool，data scope 跨 await 和 timer 保持隔离", async () => {
    const { getDb, runWithDataDbScope } = await import("@/drizzle/db");

    const controlBefore = getDb();
    const dataObservations = await runWithDataDbScope(async () => {
      const immediate = getDb();
      await Promise.resolve();
      const afterAwait = getDb();
      const afterTimer = await new Promise<ReturnType<typeof getDb>>((resolve) => {
        setTimeout(() => resolve(getDb()), 0);
      });
      return { immediate, afterAwait, afterTimer };
    });
    const controlAfter = getDb();

    expect(dataObservations.immediate).toBe(dataObservations.afterAwait);
    expect(dataObservations.immediate).toBe(dataObservations.afterTimer);
    expect(dataObservations.immediate).not.toBe(controlBefore);
    expect(controlAfter).toBe(controlBefore);
  });

  it("并行 data scope 不会把调用方的默认 control scope 泄漏为 data", async () => {
    const { getDb, runWithDataDbScope } = await import("@/drizzle/db");
    const controlDb = getDb();

    let releaseDataScope: () => void = () => {};
    const dataGate = new Promise<void>((resolve) => {
      releaseDataScope = resolve;
    });
    const dataTask = runWithDataDbScope(async () => {
      const scopedDb = getDb();
      await dataGate;
      return { scopedDb, afterGate: getDb() };
    });

    expect(getDb()).toBe(controlDb);
    releaseDataScope();
    const dataResult = await dataTask;
    expect(dataResult.scopedDb).toBe(dataResult.afterGate);
    expect(dataResult.scopedDb).not.toBe(controlDb);
    expect(getDb()).toBe(controlDb);
  });

  it("route handler wrapper 在完整异步 handler 生命周期内保持 data scope", async () => {
    const { getDb, withDataDbScope } = await import("@/drizzle/db");
    const controlDb = getDb();
    const handler = withDataDbScope(async (value: string) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return { value, db: getDb() };
    });

    const result = await handler("route");

    expect(result.value).toBe("route");
    expect(result.db).not.toBe(controlDb);
    expect(getDb()).toBe(controlDb);
  });
});
