import { afterEach, describe, expect, it, vi } from "vitest";

type OwnerOrder = "primary-first" | "fallback-first";

type TerminalRow = {
  id: number;
  createdAt: Date;
  model: string;
  originalModel: string;
  durationMs: number | null;
  statusCode: number | null;
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function toSqlText(query: {
  toQuery: (config: {
    escapeName: (name: string) => string;
    escapeParam: (index: number) => string;
    escapeString: (value: string) => string;
    paramStartIndex: { value: number };
  }) => { sql: string; params: unknown[] };
}) {
  return query.toQuery({
    escapeName: (name) => `"${name}"`,
    escapeParam: (index) => `$${index}`,
    escapeString: (value) => `'${value}'`,
    paramStartIndex: { value: 1 },
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index++) {
    await Promise.resolve();
  }
}

describe("message terminal public-status public seam", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("@/drizzle/db");
    vi.doUnmock("@/lib/config/env.schema");
    vi.doUnmock("@/lib/logger");
    vi.doUnmock("@/lib/redis");
  });

  it.each<OwnerOrder>([
    "primary-first",
    "fallback-first",
  ])("%s publishes exactly one rollup from the terminal SQL owner", async (ownerOrder) => {
    vi.resetModules();
    vi.useFakeTimers();

    const id = ownerOrder === "primary-first" ? 91_001 : 91_002;
    const row: TerminalRow = {
      id,
      createdAt: new Date("2026-07-13T12:00:00.000Z"),
      model: "gpt-4.1",
      originalModel: "gpt-4.1",
      durationMs: null,
      statusCode: null,
    };
    const releasePrimary = createDeferred<void>();
    const primaryReceipts: number[][] = [];
    const fallbackReceipts: number[][] = [];
    const primarySql: Array<{ sql: string; params: unknown[] }> = [];
    const rollupPipelines: Array<Array<{ command: string; args: unknown[] }>> = [];

    const primaryDetails = {
      durationMs: 1_200,
      statusCode: 200,
      outputTokens: 60,
      providerChain: [
        {
          id: 1,
          name: "primary-provider",
          groupTag: "openai",
          reason: "request_success" as const,
          statusCode: 200,
        },
      ],
      model: "gpt-4.1",
    };
    const fallbackDetails = {
      durationMs: 2_400,
      statusCode: 504,
      outputTokens: 0,
      errorMessage: "Error: stream_finalization_timeout",
      providerChain: [
        {
          id: 2,
          name: "fallback-provider",
          groupTag: "openai",
          reason: "retry_failed" as const,
          statusCode: 504,
        },
      ],
      model: "gpt-4.1",
    };

    const execute = vi.fn(async (query: Parameters<typeof toSqlText>[0]) => {
      const built = toSqlText(query);
      primarySql.push(built);
      await releasePrimary.promise;
      if (row.statusCode !== null) {
        primaryReceipts.push([]);
        return [];
      }
      row.durationMs = primaryDetails.durationMs;
      row.statusCode = primaryDetails.statusCode;
      primaryReceipts.push([id]);
      return [{ id }];
    });

    const writerUpdate = vi.fn(() => ({
      set: vi.fn((patch: Record<string, unknown>) => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            if (row.statusCode !== null) {
              fallbackReceipts.push([]);
              return [];
            }
            row.durationMs = patch.durationMs as number;
            row.statusCode = patch.statusCode as number;
            fallbackReceipts.push([id]);
            return [{ id }];
          }),
        })),
      })),
    }));
    const writerDb = { execute, update: writerUpdate };

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => [
                {
                  createdAt: row.createdAt,
                  model: row.model,
                  originalModel: row.originalModel,
                  durationMs: row.durationMs,
                },
              ]),
            })),
          })),
        })),
        update: vi.fn(),
      },
      getMessageWriterDb: vi.fn(() => writerDb),
    }));
    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({
        MESSAGE_REQUEST_WRITE_MODE: "async",
        MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS: 60_000,
        MESSAGE_REQUEST_ASYNC_BATCH_SIZE: 1_000,
        MESSAGE_REQUEST_ASYNC_MAX_PENDING: 1_000,
      }),
    }));
    vi.doMock("@/lib/logger", () => ({
      logger: {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    }));

    const configSnapshot = JSON.stringify({
      configVersion: "cfg-r2-seam",
      generatedAt: "2026-07-13T11:59:00.000Z",
      siteTitle: "Status",
      siteDescription: "Status",
      timeZone: "UTC",
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [
        {
          sourceGroupId: 42,
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
    const redis = {
      status: "ready",
      hincrbyfloat: vi.fn(),
      get: vi.fn(async (key: string) => {
        if (key === "public-status:v2:config-version:current") {
          return "cfg-r2-seam";
        }
        if (key === "public-status:v2:config-internal:cfg-r2-seam") {
          return configSnapshot;
        }
        return null;
      }),
      pipeline: vi.fn(() => {
        const operations: Array<{ command: string; args: unknown[] }> = [];
        return {
          hincrbyfloat: (...args: unknown[]) => {
            operations.push({ command: "hincrbyfloat", args });
          },
          set: (...args: unknown[]) => {
            operations.push({ command: "set", args });
          },
          expire: (...args: unknown[]) => {
            operations.push({ command: "expire", args });
          },
          exec: async () => {
            rollupPipelines.push(operations);
            return operations.map(() => [null, 1] as [null, number]);
          },
        };
      }),
    };
    vi.doMock("@/lib/redis", () => ({
      getRedisClient: vi.fn(() => redis),
    }));

    const { updateMessageRequestDetailsDurably, updateMessageRequestDetailsIfUnfinalized } =
      await import("@/repository/message");
    const { flushMessageRequestWriteBuffer, stopMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );

    const primary = updateMessageRequestDetailsDurably(id, primaryDetails, { timeoutMs: 10 });
    const primaryResult = primary.catch((error: unknown) => error);
    const flush = flushMessageRequestWriteBuffer();

    await vi.advanceTimersByTimeAsync(10);
    await expect(primaryResult).resolves.toEqual(
      expect.objectContaining({
        message: "durable message_request acknowledgement timed out",
      })
    );

    if (ownerOrder === "fallback-first") {
      await updateMessageRequestDetailsIfUnfinalized(id, fallbackDetails);
      releasePrimary.resolve();
      await flush;
    } else {
      releasePrimary.resolve();
      await flush;
      await updateMessageRequestDetailsIfUnfinalized(id, fallbackDetails);
    }
    await flushMicrotasks();

    expect(primarySql).toHaveLength(1);
    expect(primarySql[0]?.sql).toMatch(/"?status_code"? IS NULL/);
    expect(primarySql[0]?.sql).toContain("RETURNING id");
    expect(primaryReceipts).toEqual(ownerOrder === "primary-first" ? [[id]] : [[]]);
    expect(fallbackReceipts).toEqual(ownerOrder === "fallback-first" ? [[id]] : [[]]);
    expect(row).toMatchObject(
      ownerOrder === "primary-first"
        ? { durationMs: primaryDetails.durationMs, statusCode: primaryDetails.statusCode }
        : { durationMs: fallbackDetails.durationMs, statusCode: fallbackDetails.statusCode }
    );
    expect(redis.get.mock.calls).toEqual([
      ["public-status:v2:config-version:current"],
      ["public-status:v2:config-internal:cfg-r2-seam"],
    ]);
    expect(rollupPipelines).toHaveLength(1);

    const rollupFields = rollupPipelines[0]!
      .filter((operation) => operation.command === "hincrbyfloat")
      .map((operation) => String(operation.args[1]));
    const expectedMetric = ownerOrder === "primary-first" ? "success" : "failure";
    const losingMetric = ownerOrder === "primary-first" ? "failure" : "success";
    expect(rollupFields).toContain(`42|gpt-4.1|${expectedMetric}`);
    expect(rollupFields).not.toContain(`42|gpt-4.1|${losingMetric}`);

    await stopMessageRequestWriteBuffer();
  });

  it("same-ID pending durable merge publishes one rollup from the committed latest payload", async () => {
    vi.resetModules();
    vi.useFakeTimers();

    const id = 91_003;
    const oldFailureDetails = {
      durationMs: 4_200,
      statusCode: 502,
      inputTokens: 31,
      outputTokens: 3,
      ttfbMs: 900,
      providerChain: [
        {
          id: 11,
          name: "old-failure-provider",
          groupTag: "openai",
          reason: "retry_failed" as const,
          statusCode: 502,
        },
      ],
      providerId: 11,
      errorMessage: "Error: old upstream failure",
      model: "gpt-4.1",
    };
    const latestSuccessDetails = {
      durationMs: 1_500,
      statusCode: 200,
      outputTokens: 96,
      ttfbMs: 300,
      providerChain: [
        {
          id: 22,
          name: "latest-success-provider",
          groupTag: "openai",
          reason: "request_success" as const,
          statusCode: 200,
        },
      ],
      providerId: 22,
      model: "gpt-4.1",
    };
    const row: TerminalRow & {
      inputTokens: number | null;
      outputTokens: number | null;
      ttfbMs: number | null;
      providerChain: unknown;
      providerId: number | null;
    } = {
      id,
      createdAt: new Date("2026-07-13T12:05:00.000Z"),
      model: "gpt-4.1",
      originalModel: "gpt-4.1",
      durationMs: null,
      statusCode: null,
      inputTokens: null,
      outputTokens: null,
      ttfbMs: null,
      providerChain: null,
      providerId: null,
    };
    const releaseCommit = createDeferred<void>();
    const committedSql: Array<{ sql: string; params: unknown[] }> = [];
    const rollupPipelines: Array<Array<{ command: string; args: unknown[] }>> = [];

    const execute = vi.fn(async (query: Parameters<typeof toSqlText>[0]) => {
      const built = toSqlText(query);
      committedSql.push(built);
      await releaseCommit.promise;

      const readCaseValue = (columnName: string): unknown => {
        const column = `"${columnName}"`;
        const clauseStart = built.sql.indexOf(`${column} = CASE id`);
        const clauseEnd = built.sql.indexOf(`ELSE ${column} END`, clauseStart);
        if (clauseStart === -1 || clauseEnd === -1) {
          throw new Error(`Missing batch CASE clause for ${columnName}`);
        }

        const parameterIndexes = Array.from(
          built.sql.slice(clauseStart, clauseEnd).matchAll(/\$(\d+)/g),
          (match) => Number(match[1])
        );
        const valueParameterIndex = parameterIndexes[1];
        if (valueParameterIndex === undefined) {
          throw new Error(`Missing batch value parameter for ${columnName}`);
        }
        return built.params[valueParameterIndex - 1];
      };

      row.durationMs = Number(readCaseValue("duration_ms"));
      row.statusCode = Number(readCaseValue("status_code"));
      row.inputTokens = Number(readCaseValue("input_tokens"));
      row.outputTokens = Number(readCaseValue("output_tokens"));
      row.ttfbMs = Number(readCaseValue("ttfb_ms"));
      row.providerChain = JSON.parse(String(readCaseValue("provider_chain")));
      row.providerId = Number(readCaseValue("provider_id"));
      return [{ id }];
    });
    const writerDb = { execute, update: vi.fn() };

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => [
                {
                  createdAt: row.createdAt,
                  model: row.model,
                  originalModel: row.originalModel,
                  durationMs: row.durationMs,
                },
              ]),
            })),
          })),
        })),
        update: vi.fn(),
      },
      getMessageWriterDb: vi.fn(() => writerDb),
    }));
    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({
        MESSAGE_REQUEST_WRITE_MODE: "async",
        MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS: 60_000,
        MESSAGE_REQUEST_ASYNC_BATCH_SIZE: 1_000,
        MESSAGE_REQUEST_ASYNC_MAX_PENDING: 1_000,
      }),
    }));
    vi.doMock("@/lib/logger", () => ({
      logger: {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    }));

    const configSnapshot = JSON.stringify({
      configVersion: "cfg-r2-same-id",
      generatedAt: "2026-07-13T12:04:00.000Z",
      siteTitle: "Status",
      siteDescription: "Status",
      timeZone: "UTC",
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [
        {
          sourceGroupId: 42,
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
    const redis = {
      status: "ready",
      hincrbyfloat: vi.fn(),
      get: vi.fn(async (key: string) => {
        if (key === "public-status:v2:config-version:current") {
          return "cfg-r2-same-id";
        }
        if (key === "public-status:v2:config-internal:cfg-r2-same-id") {
          return configSnapshot;
        }
        return null;
      }),
      pipeline: vi.fn(() => {
        const operations: Array<{ command: string; args: unknown[] }> = [];
        return {
          hincrbyfloat: (...args: unknown[]) => {
            operations.push({ command: "hincrbyfloat", args });
          },
          set: (...args: unknown[]) => {
            operations.push({ command: "set", args });
          },
          expire: (...args: unknown[]) => {
            operations.push({ command: "expire", args });
          },
          exec: async () => {
            rollupPipelines.push(operations);
            return operations.map(() => [null, 1] as [null, number]);
          },
        };
      }),
    };
    vi.doMock("@/lib/redis", () => ({
      getRedisClient: vi.fn(() => redis),
    }));

    const { updateMessageRequestDetailsDurably } = await import("@/repository/message");
    const { flushMessageRequestWriteBuffer, stopMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );

    const oldFailure = updateMessageRequestDetailsDurably(id, oldFailureDetails);
    const latestSuccess = updateMessageRequestDetailsDurably(id, latestSuccessDetails);
    const flush = flushMessageRequestWriteBuffer();
    await flushMicrotasks();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(rollupPipelines).toEqual([]);
    expect(row.statusCode).toBeNull();

    releaseCommit.resolve();
    await Promise.all([oldFailure, latestSuccess, flush]);
    await flushMicrotasks();

    expect(committedSql).toHaveLength(1);
    expect(committedSql[0]?.sql).toMatch(/"?status_code"? IS NULL/);
    expect(committedSql[0]?.sql).toContain("RETURNING id");
    expect(row).toMatchObject({
      durationMs: latestSuccessDetails.durationMs,
      statusCode: latestSuccessDetails.statusCode,
      inputTokens: oldFailureDetails.inputTokens,
      outputTokens: latestSuccessDetails.outputTokens,
      ttfbMs: latestSuccessDetails.ttfbMs,
      providerChain: latestSuccessDetails.providerChain,
      providerId: latestSuccessDetails.providerId,
    });
    expect(rollupPipelines).toHaveLength(1);

    const rollupIncrementOperations = rollupPipelines[0]!.filter(
      (operation) => operation.command === "hincrbyfloat"
    );
    expect(rollupIncrementOperations).toHaveLength(5);
    const rollupIncrements = Object.fromEntries(
      rollupIncrementOperations.map((operation) => [
        String(operation.args[1]),
        Number(operation.args[2]),
      ])
    );
    expect(rollupIncrements).toEqual({
      "42|gpt-4.1|success": 1,
      "42|gpt-4.1|ttfb_sum": latestSuccessDetails.ttfbMs,
      "42|gpt-4.1|ttfb_count": 1,
      "42|gpt-4.1|tps_sum": 80,
      "42|gpt-4.1|tps_count": 1,
    });

    await stopMessageRequestWriteBuffer();
  });
});
