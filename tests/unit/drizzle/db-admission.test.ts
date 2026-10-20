import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface RawClient {
  unsafe: ReturnType<typeof vi.fn>;
  begin: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

describe("drizzle/db outstanding admission", () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    DSN: process.env.DSN,
    DB_POOL_MAX: process.env.DB_POOL_MAX,
  };

  let queryDeferreds: Deferred<unknown[]>[];
  let transactionDeferreds: Deferred<unknown>[];
  let rawClient: RawClient;
  let postgresMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    queryDeferreds = [];
    transactionDeferreds = [];
    rawClient = {
      unsafe: vi.fn(() => {
        const pending = deferred<unknown[]>();
        queryDeferreds.push(pending);
        return pending.promise;
      }),
      begin: vi.fn(() => {
        const pending = deferred<unknown>();
        transactionDeferreds.push(pending);
        return pending.promise;
      }),
      end: vi.fn(async () => {}),
    };
    postgresMock = vi.fn(() => rawClient);

    process.env.NODE_ENV = "production";
    process.env.DSN = "postgres://postgres:postgres@localhost:5432/claude_code_hub_test";
    process.env.DB_POOL_MAX = "1";

    vi.doMock("postgres", () => ({ default: postgresMock }));
    vi.doMock("drizzle-orm/postgres-js", () => ({
      drizzle: (client: unknown) => ({ $client: client }),
    }));
  });

  afterEach(() => {
    for (const pending of queryDeferreds) pending.resolve([]);
    for (const pending of transactionDeferreds) pending.resolve(undefined);
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("在创建底层 unsafe query 前拒绝超额工作，并在 resolve/reject 后精确释放", async () => {
    const { getDb } = await import("@/drizzle/db");
    const client = (getDb() as unknown as { $client: RawClient }).$client;
    const observed: Promise<unknown>[] = [];
    const queries: PromiseLike<unknown>[] = [];
    let admissionError: unknown;

    for (let index = 0; index < 256; index += 1) {
      try {
        const query = client.unsafe("select 1");
        queries.push(query);
        observed.push(Promise.resolve(query).catch(() => undefined));
      } catch (error) {
        admissionError = error;
        break;
      }
    }

    expect(admissionError).toMatchObject({ code: "DB_POOL_ADMISSION_EXCEEDED" });
    expect(rawClient.unsafe).toHaveBeenCalledTimes(queries.length);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.length).toBeLessThan(256);

    const duplicateObserver = Promise.resolve(queries[0]).catch(() => undefined);
    queryDeferreds[0].resolve([]);
    await Promise.all([observed[0], duplicateObserver]);

    const replacementAfterResolve = client.unsafe("select 2");
    const replacementResolveObserved = Promise.resolve(replacementAfterResolve).catch(
      () => undefined
    );
    expect(() => client.unsafe("select rejected after one exact release")).toThrowError(
      expect.objectContaining({ code: "DB_POOL_ADMISSION_EXCEEDED" })
    );

    queryDeferreds[1].reject(new Error("simulated query failure"));
    await observed[1];

    const replacementAfterReject = client.unsafe("select 3");
    const replacementRejectObserved = Promise.resolve(replacementAfterReject).catch(
      () => undefined
    );
    expect(() => client.unsafe("select still bounded")).toThrowError(
      expect.objectContaining({ code: "DB_POOL_ADMISSION_EXCEEDED" })
    );

    queryDeferreds.at(-2)?.resolve([]);
    queryDeferreds.at(-1)?.resolve([]);
    await Promise.all([replacementResolveObserved, replacementRejectObserved]);
  });

  it("transaction begin 与 raw unsafe 共用同一 admission，超额 begin 不创建底层事务", async () => {
    const { getDb } = await import("@/drizzle/db");
    const client = (getDb() as unknown as { $client: RawClient }).$client;
    const observed: Promise<unknown>[] = [];

    for (let index = 0; index < 256; index += 1) {
      try {
        const query = client.unsafe("select saturate");
        observed.push(Promise.resolve(query).catch(() => undefined));
      } catch {
        break;
      }
    }
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.length).toBeLessThan(256);

    expect(() => client.begin(async () => undefined)).toThrowError(
      expect.objectContaining({ code: "DB_POOL_ADMISSION_EXCEEDED" })
    );
    expect(rawClient.begin).not.toHaveBeenCalled();

    queryDeferreds[0].resolve([]);
    await observed[0];

    const transaction = client.begin(async () => "done") as unknown as Promise<unknown>;
    expect(rawClient.begin).toHaveBeenCalledTimes(1);
    expect(() => client.unsafe("select blocked by transaction")).toThrowError(
      expect.objectContaining({ code: "DB_POOL_ADMISSION_EXCEEDED" })
    );

    transactionDeferreds[0].resolve("done");
    await expect(transaction).resolves.toBe("done");

    const acceptedAfterTransaction = client.unsafe("select after transaction");
    const acceptedObserved = Promise.resolve(acceptedAfterTransaction).catch(() => undefined);
    queryDeferreds.at(-1)?.resolve([]);
    await acceptedObserved;
  });

  it("cancel 未执行的 lazy query 时不应通过 then 重新启动查询", async () => {
    const { createAdmittedSqlClient } = await import("@/drizzle/admitted-client");
    const makeLazyQuery = () => ({
      executed: false,
      then: vi.fn(),
      cancel: vi.fn(() => null),
    });
    const first = makeLazyQuery();
    const second = makeLazyQuery();
    const client = {
      unsafe: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
      begin: vi.fn(),
    };
    const admitted = createAdmittedSqlClient(client, { pool: "data", maxOutstanding: 1 });

    const firstQuery = admitted.unsafe() as typeof first;
    firstQuery.cancel();

    expect(first.then).not.toHaveBeenCalled();
    expect(first.cancel).toHaveBeenCalledOnce();
    expect(() => admitted.unsafe()).not.toThrow();
  });

  it("tagged-template query 也受同一 admission 上限保护", async () => {
    const { createAdmittedSqlClient } = await import("@/drizzle/admitted-client");
    const first = deferred<unknown[]>();
    const second = deferred<unknown[]>();
    const raw = Object.assign(
      vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
      { unsafe: vi.fn(), begin: vi.fn() }
    );
    const admitted = createAdmittedSqlClient(raw, { pool: "data", maxOutstanding: 1 });

    const firstQuery = admitted`select 1`;
    expect(() => admitted`select 2`).toThrowError(
      expect.objectContaining({ code: "DB_POOL_ADMISSION_EXCEEDED" })
    );
    expect(raw).toHaveBeenCalledTimes(1);

    first.resolve([]);
    await firstQuery;

    const secondQuery = admitted`select 2`;
    second.resolve([]);
    await secondQuery;
    expect(raw).toHaveBeenCalledTimes(2);
  });

  it("Drizzle query wrapper 从 cause 提取 SQLSTATE 但不暴露原始内容", async () => {
    const { findSafeDatabaseError } = await import("@/drizzle/admitted-client");
    const details = findSafeDatabaseError({
      name: "DrizzleQueryError",
      query: "select * from secrets where token = $1",
      params: ["admission-canary"],
      cause: { code: "55P03" },
    });

    expect(details).toEqual({ kind: "query", code: "55P03", message: "Database query failed" });
    expect(JSON.stringify(details)).not.toContain("admission-canary");
  });
});
