import { CasingCache } from "drizzle-orm/casing";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SqlQuery = {
  toQuery: (config: {
    escapeName: (name: string) => string;
    escapeParam: (index: number) => string;
    escapeString: (value: string) => string;
    casing: CasingCache;
    paramStartIndex: { value: number };
  }) => { sql: string; params: unknown[] };
};

const boundary = vi.hoisted(() => ({
  execute: vi.fn<(query: unknown) => Promise<readonly unknown[]>>(),
  getWriterDb: vi.fn(() => ({ execute: vi.fn() })),
}));

vi.mock("@/drizzle/db", () => ({
  db: { execute: boundary.execute },
  getMessageWriterDb: boundary.getWriterDb,
}));
vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => ({ MESSAGE_REQUEST_WRITE_MODE: "sync" }),
  isDevelopment: () => false,
}));
vi.mock("@/lib/ledger-fallback", () => ({ isLedgerOnlyMode: vi.fn(async () => false) }));

function renderSql(value: unknown) {
  if (typeof value !== "object" || value === null || !("toQuery" in value)) {
    throw new TypeError("Expected a Drizzle SQL query");
  }

  return (value as SqlQuery).toQuery({
    escapeName: (name) => `"${name}"`,
    escapeParam: (index) => `$${index}`,
    escapeString: (text) => `'${text}'`,
    casing: new CasingCache(),
    paramStartIndex: { value: 1 },
  });
}

describe("materializeReplayAuditFromSource", () => {
  beforeEach(() => {
    boundary.execute.mockReset();
  });

  it("only materializes a successful terminal source while preserving zero-cost Replay", async () => {
    boundary.execute.mockResolvedValueOnce([{ id: 501 }]);
    const { materializeReplayAuditFromSource } = await import("@/repository/message");

    await expect(materializeReplayAuditFromSource(501, 202)).resolves.toBe(true);

    const query = renderSql(boundary.execute.mock.calls[0]?.[0]);
    expect(query.sql).toMatch(/UPDATE message_request AS replay/i);
    expect(query.sql).toMatch(/source\.status_code\s*>=\s*200/i);
    expect(query.sql).toMatch(/source\.status_code\s*<\s*400/i);
    expect(query.sql).toMatch(/COALESCE\(source\.error_message, ''\)\s*=\s*''/i);
    expect(query.sql).toMatch(/replay_source_request_id\s*=\s*source\.id/i);
    expect(query.sql).toMatch(/is_replay\s*=\s*TRUE/i);
    expect(query.sql).toMatch(/cost_usd\s*=\s*0/i);
    expect(query.sql).toMatch(/cost_breakdown\s*=\s*NULL/i);
    expect(query.params).toEqual([501, 202]);
  });

  it("reports no materialization when the source does not satisfy the terminal guard", async () => {
    boundary.execute.mockResolvedValueOnce([]);
    const { materializeReplayAuditFromSource } = await import("@/repository/message");

    await expect(materializeReplayAuditFromSource(502, 203)).resolves.toBe(false);
  });
});
