import { CasingCache } from "drizzle-orm/casing";
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
    casing: new CasingCache(),
    escapeName: (name: string) => `"${name}"`,
    escapeParam: (index: number) => `$${index}`,
    escapeString: (value: string) => `'${value}'`,
    paramStartIndex: { value: 1 },
  });
}

describe("sealOrphanedMessageRequests", () => {
  const envKeys = ["NODE_ENV", "DSN", "FETCH_BODY_TIMEOUT"];
  const originalEnv = snapshotEnv(envKeys);

  const executeMock = vi.fn(async () => [{ id: 1 }, { id: 2 }]);

  beforeEach(() => {
    vi.resetModules();
    executeMock.mockClear();

    process.env.NODE_ENV = "test";
    process.env.DSN = "postgres://postgres:postgres@localhost:5432/claude_code_hub_test";
    process.env.FETCH_BODY_TIMEOUT = "1000";

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

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
    vi.useRealTimers();
    restoreEnv(originalEnv);
  });

  it("应批量封闭超时仍未落终态的 message_request 并返回 sealedCount", async () => {
    const { sealOrphanedMessageRequests } = await import("@/repository/message");
    const { ORPHANED_MESSAGE_REQUEST_ERROR_CODE, ORPHANED_MESSAGE_REQUEST_STATUS_CODE } =
      await import("@/repository/message-orphaned-requests");

    const result = await sealOrphanedMessageRequests({ staleAfterMs: 10, limit: 5 });

    expect(result.sealedCount).toBe(2);
    expect(executeMock).toHaveBeenCalledTimes(1);

    const query = executeMock.mock.calls[0]?.[0];
    const built = toSqlText(query);

    expect(built.sql).toContain("UPDATE message_request");
    expect(built.sql).toContain("duration_ms IS NULL");
    expect(built.sql).toContain("status_code IS NULL");
    expect((built.sql.match(/updated_at </g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(built.sql).toContain("blocked_by");
    expect(built.sql).toContain("warmup");
    expect(built.sql).toContain("duration_ms = COALESCE");
    expect(built.sql).toContain("status_code =");
    expect(built.sql).toContain("error_message =");
    expect(built.sql).toContain("LIMIT");

    expect(built.params).toContain(ORPHANED_MESSAGE_REQUEST_STATUS_CODE);
    expect(built.params).toContain(ORPHANED_MESSAGE_REQUEST_ERROR_CODE);
    expect(built.params).toContain(5);

    const threshold = built.params.find((p) => p instanceof Date) as Date | undefined;
    expect(threshold).toBeInstanceOf(Date);
    expect(threshold?.toISOString()).toBe("2025-12-31T23:59:00.000Z");
  });

  it("默认 staleAfterMs 应基于 FETCH_BODY_TIMEOUT + 60s 且不低于 60s", async () => {
    const { sealOrphanedMessageRequests } = await import("@/repository/message");

    await sealOrphanedMessageRequests();

    expect(executeMock).toHaveBeenCalledTimes(1);

    const query = executeMock.mock.calls[0]?.[0];
    const built = toSqlText(query);

    const threshold = built.params.find((p) => p instanceof Date) as Date | undefined;
    expect(threshold).toBeInstanceOf(Date);
    // FETCH_BODY_TIMEOUT=1000ms -> staleAfterMs=61000ms
    expect(threshold?.toISOString()).toBe("2025-12-31T23:58:59.000Z");
  });
});
