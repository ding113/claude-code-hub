import { beforeEach, describe, expect, test, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("@/drizzle/db", () => ({
  db: {
    execute: executeMock,
  },
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn(async () => "Asia/Shanghai"),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("getRateLimitEventStats query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("casts time filters as timestamptz ISO parameters", async () => {
    const start = new Date("2026-04-23T08:28:28.258Z");
    const end = new Date("2026-04-30T08:28:28.258Z");
    let capturedQuery: unknown;

    executeMock.mockImplementation(async (query: unknown) => {
      capturedQuery = query;
      return [
        {
          id: 1,
          user_id: 2,
          provider_id: 3,
          error_message: 'rate_limit_metadata: {"limit_type":"rpm","current":95}',
          hour: new Date("2026-04-30T08:00:00.000Z"),
        },
      ];
    });

    const { getRateLimitEventStats } = await import("@/repository/statistics");
    const stats = await getRateLimitEventStats({ start_time: start, end_time: end });

    expect(stats.total_events).toBe(1);
    expect(executeMock).toHaveBeenCalledOnce();

    const chunks = collectSqlChunks(capturedQuery);
    expect(chunks.dates).toEqual([]);
    expect(chunks.strings).toEqual(
      expect.arrayContaining([start.toISOString(), end.toISOString()])
    );
    expect(chunks.strings.join(" ")).toContain("::timestamptz");
    expect(chunks.strings.join(" ")).not.toContain("created_at >= $1");
    expect(chunks.strings.join(" ")).not.toContain("created_at <= $2");
  });
});

function collectSqlChunks(value: unknown): { strings: string[]; dates: Date[] } {
  const strings: string[] = [];
  const dates: Date[] = [];
  const seen = new Set<object>();

  const visit = (item: unknown) => {
    if (typeof item === "string") {
      strings.push(item);
      return;
    }
    if (item instanceof Date) {
      dates.push(item);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== "object" || seen.has(item)) return;

    seen.add(item);
    const record = item as { queryChunks?: unknown; value?: unknown };
    if ("queryChunks" in record) visit(record.queryChunks);
    if ("value" in record) visit(record.value);
  };

  visit(value);
  return { strings, dates };
}
