import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  type MigrationIndexPreflightExecutor,
  runSessionReplayIndexPreflight,
  SESSION_REPLAY_INDEX_SPECS,
} from "@/lib/migrations/session-replay-index-preflight";

const isLedgerOnlyModeMock = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
vi.mock("@/lib/ledger-fallback", () => ({
  isLedgerOnlyMode: isLedgerOnlyModeMock,
}));

const dsn = process.env.DSN || process.env.DATABASE_URL;

describe.skipIf(!dsn)("Session identity PostgreSQL integration", () => {
  let client: ReturnType<typeof postgres>;
  let findSuggestions: typeof import("@/repository/usage-logs").findUsageLogSessionIdSuggestions;

  beforeAll(async () => {
    client = postgres(dsn!, { max: 1 });
    await client`SET search_path TO pg_temp, public`;
    // The repository's unqualified tables resolve to connection-local fixtures.
    // Concurrent index tests below explicitly target the migrated public tables.
    await client.unsafe(`
      CREATE TEMP TABLE message_request (
        id serial PRIMARY KEY,
        session_id varchar(64),
        session_identity varchar(64),
        created_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        blocked_by varchar(32)
      );
      CREATE TEMP TABLE usage_ledger (LIKE message_request INCLUDING ALL);
    `);
    vi.resetModules();
    vi.doMock("@/drizzle/db", () => ({ db: drizzle(client) }));
    ({ findUsageLogSessionIdSuggestions: findSuggestions } = await import(
      "@/repository/usage-logs"
    ));
  });

  afterAll(async () => {
    vi.doUnmock("@/drizzle/db");
    await client?.end();
  });

  test("round-trips every index through pg_get_indexdef and reuses it on the next preflight", async () => {
    const indexClient = postgres(dsn!, { max: 1 });
    const suffix = randomBytes(6).toString("hex");
    const specs = SESSION_REPLAY_INDEX_SPECS.map((spec, index) => ({
      ...spec,
      canonicalName: `it_session_${suffix}_${index}`,
      temporaryName: `it_session_tmp_${suffix}_${index}`,
    }));
    const statements: string[] = [];
    const executor: MigrationIndexPreflightExecutor = {
      execute: async (statement) => {
        statements.push(statement);
        await indexClient.unsafe(statement);
      },
      inspectIndex: async (name) => {
        const [row] = await indexClient`
          SELECT i.indisvalid AS valid,
                 obj_description(c.oid, 'pg_class') AS marker,
                 pg_get_indexdef(c.oid) AS definition
          FROM pg_class c
          JOIN pg_index i ON i.indexrelid = c.oid
          WHERE c.oid = to_regclass(${`public.${name}`})
        `;
        return {
          exists: Boolean(row),
          valid: row?.valid === true,
          marker: row?.marker ?? null,
          definition: row?.definition ?? null,
        };
      },
    };
    const indexOids = async () => {
      const rows = await indexClient`
        SELECT c.relname, c.oid FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace
          AND c.relname IN ${indexClient(specs.map((spec) => spec.canonicalName))}
        ORDER BY c.relname
      `;
      return Array.from(rows);
    };

    try {
      await runSessionReplayIndexPreflight(executor, specs, { ensureColumns: false });
      const installed = await indexOids();
      expect(installed).toHaveLength(specs.length);
      statements.length = 0;
      await runSessionReplayIndexPreflight(executor, specs, { ensureColumns: false });
      expect(await indexOids()).toEqual(installed);
      expect(statements.some((statement) => /^(CREATE|DROP|ALTER) INDEX/.test(statement))).toBe(
        false
      );
    } finally {
      try {
        for (const spec of specs) {
          await indexClient.unsafe(
            `DROP INDEX CONCURRENTLY IF EXISTS "public"."${spec.canonicalName}"`
          );
          await indexClient.unsafe(
            `DROP INDEX CONCURRENTLY IF EXISTS "public"."${spec.temporaryName}"`
          );
        }
      } finally {
        await indexClient.end();
      }
    }
  });

  test.each([
    { ledgerOnly: false, source: "canonical" },
    { ledgerOnly: false, source: "physical" },
    { ledgerOnly: true, source: "canonical" },
    { ledgerOnly: true, source: "physical" },
  ])(
    "preserves copied UUID case for $source IDs with ledgerOnly=$ledgerOnly",
    async ({ ledgerOnly, source }) => {
      isLedgerOnlyModeMock.mockResolvedValue(ledgerOnly);
      await client`TRUNCATE pg_temp.message_request, pg_temp.usage_ledger`;
      const tableName = ledgerOnly ? "usage_ledger" : "message_request";
      const sessionIds = [
        "5DEA8822-A7BA-4454-9F39-408FF2095999",
        "5dEa8822-a7Ba-4454-9f39-408Ff2095999",
        "5dea8822-a7ba-4454-9f39-408ff2095999",
      ];
      for (const sessionId of sessionIds) {
        await client`
        INSERT INTO ${client(`pg_temp.${tableName}`)} (session_id, session_identity)
        VALUES (
          ${source === "physical" ? sessionId : "sid:unrelated"},
          ${source === "canonical" ? sessionId : "sid:unrelated"}
        )
      `;
      }
      for (const sessionId of sessionIds) {
        expect(await findSuggestions({ term: sessionId })).toEqual([sessionId]);
      }
    }
  );
});
