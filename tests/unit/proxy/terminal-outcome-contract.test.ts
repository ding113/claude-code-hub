import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import { afterEach, describe, expect, it, vi } from "vitest";

type SqlQuery = {
  toQuery: (config: {
    escapeName: (name: string) => string;
    escapeParam: (index: number) => string;
    escapeString: (value: string) => string;
    paramStartIndex: { value: number };
  }) => { sql: string; params: unknown[] };
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

function toSqlText(query: SqlQuery) {
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

describe("terminal outcome contract", () => {
  afterEach(() => {
    vi.doUnmock("@/app/v1/_lib/proxy/errors");
    vi.doUnmock("@/drizzle/db");
    vi.doUnmock("@/lib/config/env.schema");
    vi.doUnmock("@/lib/config/system-settings-cache");
    vi.doUnmock("@/lib/langfuse/emit-proxy-trace");
    vi.doUnmock("@/lib/logger");
    vi.doUnmock("@/lib/proxy-status-tracker");
    vi.doUnmock("@/lib/redis");
  });

  it("waits for one committed top-level error outcome before returning and rolling up", async () => {
    vi.resetModules();

    const messageRequestId = 92_001;
    const releaseCommit = createDeferred<void>();
    const executedSql: Array<{ sql: string; params: unknown[] }> = [];
    const rollupPipelines: Array<Array<{ command: string; args: unknown[] }>> = [];
    const execute = vi.fn(async (query: SqlQuery) => {
      executedSql.push(toSqlText(query));
      await releaseCommit.promise;
      return [{ id: messageRequestId }];
    });
    const createdAt = new Date("2026-07-15T00:00:00.000Z");
    const insert = vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [
          {
            id: messageRequestId,
            providerId: 7,
            userId: 42,
            key: "sk-terminal-outcome",
            model: "gpt-4.1",
            originalModel: "gpt-4.1",
            durationMs: null,
            costUsd: "0.125",
            costMultiplier: "1",
            sessionId: "terminal-outcome-session",
            requestSequence: 1,
            userAgent: "vitest",
            clientIp: "127.0.0.1",
            endpoint: "/v1/responses",
            messagesCount: 1,
            cacheTtlApplied: null,
            cacheCreationInputTokens: null,
            cacheCreation5mInputTokens: null,
            cacheCreation1hInputTokens: null,
            cacheReadInputTokens: null,
            specialSettings: null,
            createdAt,
            updatedAt: createdAt,
            deletedAt: null,
          },
        ]),
      })),
    }));

    vi.doMock("@/drizzle/db", () => ({
      db: { insert, select: vi.fn(), update: vi.fn() },
      getMessageWriterDb: vi.fn(() => ({ execute, update: vi.fn() })),
    }));
    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({
        MESSAGE_REQUEST_WRITE_MODE: "async",
        MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS: 60_000,
        MESSAGE_REQUEST_ASYNC_BATCH_SIZE: 1_000,
        MESSAGE_REQUEST_ASYNC_MAX_PENDING: 1_000,
      }),
    }));
    vi.doMock("@/lib/config/system-settings-cache", () => ({
      getCachedSystemSettings: vi.fn(async () => ({
        passThroughUpstreamErrorMessage: false,
        verboseProviderError: false,
      })),
    }));
    vi.doMock("@/lib/langfuse/emit-proxy-trace", () => ({ emitProxyLangfuseTrace: vi.fn() }));
    vi.doMock("@/lib/proxy-status-tracker", () => ({
      ProxyStatusTracker: { getInstance: () => ({ endRequest: vi.fn() }) },
    }));
    vi.doMock("@/lib/logger", () => ({
      logger: {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      },
    }));

    const configSnapshot = JSON.stringify({
      configVersion: "cfg-terminal-outcome",
      generatedAt: "2026-07-14T23:59:00.000Z",
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
        if (key === "public-status:v2:config-version:current") return "cfg-terminal-outcome";
        if (key === "public-status:v2:config-internal:cfg-terminal-outcome") {
          return configSnapshot;
        }
        return null;
      }),
      pipeline: vi.fn(() => {
        const operations: Array<{ command: string; args: unknown[] }> = [];
        return {
          hincrbyfloat: (...args: unknown[]) => operations.push({ command: "hincrbyfloat", args }),
          set: (...args: unknown[]) => operations.push({ command: "set", args }),
          expire: (...args: unknown[]) => operations.push({ command: "expire", args }),
          exec: async () => {
            rollupPipelines.push(operations);
            return operations.map(() => [null, 1] as [null, number]);
          },
        };
      }),
    };
    vi.doMock("@/lib/redis", () => ({ getRedisClient: vi.fn(() => redis) }));
    vi.doMock("@/app/v1/_lib/proxy/errors", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/app/v1/_lib/proxy/errors")>();
      return { ...actual, getErrorOverrideAsync: vi.fn(async () => undefined) };
    });

    const { ProxyErrorHandler } = await import("@/app/v1/_lib/proxy/error-handler");
    const { createMessageRequest } = await import("@/repository/message");
    const { flushMessageRequestWriteBuffer, stopMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );

    await createMessageRequest({
      provider_id: 7,
      user_id: 42,
      key: "sk-terminal-outcome",
      model: "gpt-4.1",
      original_model: "gpt-4.1",
      cost_usd: 0.125,
    });
    const session = {
      sessionId: "terminal-outcome-session",
      messageContext: {
        id: messageRequestId,
        user: { id: 42, name: "test-user" },
        key: { id: 2, name: "test-key" },
      },
      startTime: Date.now() - 250,
      requestUrl: new URL("https://gateway.test/v1/responses"),
      request: { message: { model: "gpt-4.1" }, model: "gpt-4.1", log: "{}" },
      provider: { id: 7, name: "provider-a", providerType: "openai", swapCacheTtlBilling: false },
      getProviderChain: () => [
        {
          id: 7,
          name: "provider-a",
          groupTag: "openai",
          reason: "retry_failed",
          statusCode: 500,
        },
      ],
      getCurrentModel: () => "gpt-4.1",
      getContext1mApplied: () => false,
      getGroupCostMultiplier: () => 1,
      getSpecialSettings: () => null,
    } as ProxySession;

    const handlePromise = ProxyErrorHandler.handle(session, new Error("top-level failure"));
    await flushMicrotasks();
    const flushPromise = flushMessageRequestWriteBuffer();
    await flushMicrotasks();

    let settled = false;
    void handlePromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(rollupPipelines).toEqual([]);
    expect(executedSql[0]?.sql).toContain("duration_ms");
    expect(executedSql[0]?.sql).toContain("status_code");
    expect(executedSql[0]?.sql).toContain("error_message");
    expect(executedSql[0]?.sql).toMatch(/"?status_code"? IS NULL/);
    expect(executedSql[0]?.sql).toContain("RETURNING id");

    releaseCommit.resolve();
    await flushPromise;
    const response = await handlePromise;

    expect(response.status).toBe(500);
    expect(execute).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(rollupPipelines).toHaveLength(1));
    await stopMessageRequestWriteBuffer();
  });
});
