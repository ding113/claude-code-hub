import { CasingCache } from "drizzle-orm/casing";
import { afterEach, describe, expect, it, vi } from "vitest";

type SqlQuery = {
  toQuery: (config: {
    escapeName: (name: string) => string;
    escapeParam: (index: number) => string;
    escapeString: (value: string) => string;
    casing: CasingCache;
    paramStartIndex: { value: number };
  }) => { sql: string; params: unknown[] };
};

function createDeferred<T>() {
  return Promise.withResolvers<T>();
}

function isSqlQuery(value: unknown): value is SqlQuery {
  return typeof value === "object" && value !== null && "toQuery" in value;
}

function renderSql(value: unknown) {
  if (!isSqlQuery(value)) throw new TypeError("Expected a Drizzle SQL query");
  return value.toQuery({
    escapeName: (name) => `"${name}"`,
    escapeParam: (index) => `$${index}`,
    escapeString: (text) => `'${text}'`,
    casing: new CasingCache(),
    paramStartIndex: { value: 1 },
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

function installCasBoundaries(returnedRows: readonly { readonly id: number }[]) {
  const writerReturning = vi.fn(async (_selection: unknown) => returnedRows);
  const writerWhere = vi.fn((_condition: unknown) => ({ returning: writerReturning }));
  const writerSet = vi.fn((_patch: Record<string, unknown>) => ({ where: writerWhere }));
  const writerUpdate = vi.fn((_table: unknown) => ({ set: writerSet }));
  const defaultUpdate = vi.fn();
  const getRedisClient = vi.fn(() => null);

  vi.doMock("@/drizzle/db", () => ({
    db: { update: defaultUpdate, select: vi.fn(), execute: vi.fn() },
    getMessageWriterDb: vi.fn(() => ({ update: writerUpdate, execute: vi.fn() })),
  }));
  vi.doMock("@/lib/config/env.schema", () => ({
    getEnvConfig: vi.fn(() => ({ MESSAGE_REQUEST_WRITE_MODE: "async" as const })),
    isDevelopment: vi.fn(() => false),
  }));
  vi.doMock("@/lib/redis", () => ({ getRedisClient }));

  return { defaultUpdate, getRedisClient, writerReturning, writerSet, writerWhere };
}

function installAsyncDurableBoundaries(execute: (query: SqlQuery) => Promise<unknown[]>) {
  const createdAt = new Date("2026-07-15T09:00:00.000Z");
  const select = vi.fn((_selection: unknown) => ({
    from: vi.fn((_table: unknown) => ({
      where: vi.fn((_condition: unknown) => ({
        limit: vi.fn(async (_limit: number) => [
          { createdAt, model: "gpt-4.1", originalModel: "gpt-4.1", durationMs: null },
        ]),
      })),
    })),
  }));
  const redisGet = vi.fn(async (key: string) => {
    if (key === "public-status:v2:config-version:current") return "cfg-terminal";
    if (key !== "public-status:v2:config-internal:cfg-terminal") return null;
    return JSON.stringify({
      configVersion: "cfg-terminal",
      generatedAt: "2026-07-15T08:59:00.000Z",
      siteTitle: "Status",
      siteDescription: "Status",
      timeZone: "UTC",
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [
        {
          sourceGroupId: 8,
          sourceGroupName: "openai",
          slug: "openai",
          displayName: "OpenAI",
          sortOrder: 1,
          description: null,
          models: [
            {
              publicModelKey: "gpt-4.1",
              label: "GPT-4.1",
              vendorIconKey: "openai",
              requestTypeBadge: "openaiCompatible",
            },
          ],
        },
      ],
    });
  });
  const operations: string[] = [];
  const pipelineExec = vi.fn(async () => operations.map(() => [null, 1] as const));
  const pipeline = {
    hincrbyfloat: vi.fn((_key: string, field: string, _value: number) => operations.push(field)),
    set: vi.fn((_key: string) => operations.push("coverage")),
    expire: vi.fn((_key: string) => operations.push("expiry")),
    exec: pipelineExec,
  };
  const redis = {
    status: "ready",
    get: redisGet,
    hincrbyfloat: vi.fn(),
    pipeline: vi.fn(() => pipeline),
  };

  vi.doMock("@/drizzle/db", () => ({
    db: { select, update: vi.fn(), execute: vi.fn() },
    getMessageWriterDb: vi.fn(() => ({ execute, update: vi.fn() })),
  }));
  vi.doMock("@/lib/config/env.schema", () => ({
    getEnvConfig: vi.fn(() => ({
      MESSAGE_REQUEST_WRITE_MODE: "async" as const,
      MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS: 60_000,
      MESSAGE_REQUEST_ASYNC_BATCH_SIZE: 1,
      MESSAGE_REQUEST_ASYNC_MAX_PENDING: 100,
    })),
    isDevelopment: vi.fn(() => false),
  }));
  vi.doMock("@/lib/redis", () => ({ getRedisClient: vi.fn(() => redis) }));

  return { pipelineExec, redisGet };
}

function installSyncDurableBoundaries() {
  const where = vi.fn(async (_condition: unknown) => []);
  const set = vi.fn((_patch: Record<string, unknown>) => ({ where }));
  const update = vi.fn((_table: unknown) => ({ set }));
  const writerExecute = vi.fn();
  vi.doMock("@/drizzle/db", () => ({
    db: { update, select: vi.fn(), execute: vi.fn() },
    getMessageWriterDb: vi.fn(() => ({ execute: writerExecute, update: vi.fn() })),
  }));
  vi.doMock("@/lib/config/env.schema", () => ({
    getEnvConfig: vi.fn(() => ({ MESSAGE_REQUEST_WRITE_MODE: "sync" as const })),
    isDevelopment: vi.fn(() => false),
  }));
  vi.doMock("@/lib/redis", () => ({ getRedisClient: vi.fn(() => null) }));
  return { set, writerExecute };
}

describe("message terminal CAS and durable acknowledgement", () => {
  afterEach(() => {
    vi.doUnmock("@/drizzle/db");
    vi.doUnmock("@/lib/config/env.schema");
    vi.doUnmock("@/lib/redis");
  });

  it("claims an unfinalized request through the dedicated writer DB", async () => {
    vi.resetModules();
    const boundary = installCasBoundaries([{ id: 801 }]);
    const { updateMessageRequestDetailsIfUnfinalized } = await import("@/repository/message");

    await updateMessageRequestDetailsIfUnfinalized(801, {
      statusCode: 504,
      errorMessage: "timeout",
    });

    expect(boundary.writerSet).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 504, errorMessage: "timeout" })
    );
    expect(renderSql(boundary.writerWhere.mock.calls[0]?.[0]).sql).toMatch(/status_code.*IS NULL/i);
    expect(boundary.writerReturning).toHaveBeenCalledWith({ id: expect.anything() });
    expect(boundary.defaultUpdate).not.toHaveBeenCalled();
  });

  it("leaves the existing terminal owner untouched when the CAS loses", async () => {
    vi.resetModules();
    const boundary = installCasBoundaries([]);
    const { updateMessageRequestDetailsIfUnfinalized } = await import("@/repository/message");

    const result = await updateMessageRequestDetailsIfUnfinalized(802, {
      statusCode: 500,
      providerChain: [{ id: 4, name: "fallback", groupTag: "openai" }],
    });

    expect(result).toBeUndefined();
    expect(boundary.writerReturning).toHaveBeenCalledTimes(1);
    expect(boundary.getRedisClient).not.toHaveBeenCalled();
    expect(boundary.defaultUpdate).not.toHaveBeenCalled();
  });

  it("keeps durable completion pending until SQL commits, then publishes the receipt", async () => {
    vi.resetModules();
    const databaseCommit = createDeferred<unknown[]>();
    const execute = vi.fn(async (_query: SqlQuery) => databaseCommit.promise);
    const { pipelineExec, redisGet } = installAsyncDurableBoundaries(execute);
    const { updateMessageRequestDetailsDurably } = await import("@/repository/message");

    const completion = updateMessageRequestDetailsDurably(803, {
      durationMs: 1_250,
      statusCode: 200,
      outputTokens: 50,
      providerChain: [
        { id: 8, name: "winner", groupTag: "openai", reason: "request_success", statusCode: 200 },
      ],
      model: "gpt-4.1",
    });

    await expect(
      Promise.race([completion.then(() => "committed"), Promise.resolve("pending")])
    ).resolves.toBe("pending");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(redisGet).not.toHaveBeenCalled();

    databaseCommit.resolve([{ id: 803 }]);
    await completion;
    await flushMicrotasks();

    expect(redisGet).toHaveBeenCalled();
    expect(pipelineExec).toHaveBeenCalledTimes(1);
  });

  it("uses the direct DB update path when durable mode is synchronous", async () => {
    vi.resetModules();
    const { set, writerExecute } = installSyncDurableBoundaries();
    const { updateMessageRequestDetailsDurably } = await import("@/repository/message");

    await updateMessageRequestDetailsDurably(804, { durationMs: 900, statusCode: 201 });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: 900, statusCode: 201, updatedAt: expect.any(Date) })
    );
    expect(writerExecute).not.toHaveBeenCalled();
  });
});
