import { describe, expect, test, vi } from "vitest";
import {
  DATABASE_TIMEOUT_INDEX_MARKER,
  DATABASE_TIMEOUT_INDEX_MIGRATION_CREATED_AT,
  SESSION_REPLAY_INDEX_MARKER,
  SESSION_REPLAY_INDEX_SPECS,
  SESSION_REPLAY_MIGRATION_CREATED_AT,
  runSessionReplayIndexPreflight,
  runSessionReplayMigrationPlan,
  type MigrationIndexState,
} from "@/lib/migrations/session-replay-index-preflight";

function createFakeExecutor(initial: Record<string, MigrationIndexState> = {}) {
  const states = new Map(Object.entries(initial));
  const execute = vi.fn(async (sql: string) => {
    const createName = sql.match(/^CREATE INDEX CONCURRENTLY "([^"]+)"/)?.[1];
    if (createName) {
      states.set(createName, { exists: true, valid: true, marker: null });
      return;
    }

    const comment = sql.match(/^COMMENT ON INDEX (?:"public"\.)?"([^"]+)" IS '([^']+)'/)?.slice(1);
    if (comment) {
      const [commentName, marker] = comment;
      const state = states.get(commentName);
      if (!state) throw new Error(`missing index ${commentName}`);
      states.set(commentName, { ...state, marker });
      return;
    }

    const dropName = sql.match(/^DROP INDEX CONCURRENTLY IF EXISTS (?:"public"\.)?"([^"]+)"/)?.[1];
    if (dropName) {
      states.delete(dropName);
      return;
    }

    const rename = sql.match(/^ALTER INDEX (?:"public"\.)?"([^"]+)" RENAME TO "([^"]+)"/)?.slice(1);
    if (rename) {
      const [from, to] = rename;
      const state = states.get(from);
      if (!state) throw new Error(`missing index ${from}`);
      states.delete(from);
      states.set(to, state);
    }
  });
  const inspectIndex = vi.fn(
    async (name: string) => states.get(name) ?? { exists: false, valid: false, marker: null }
  );
  return { executor: { execute, inspectIndex }, execute, inspectIndex, states };
}

describe("database index concurrent preflight", () => {
  const spec = SESSION_REPLAY_INDEX_SPECS[0];
  const hydrationSpec = SESSION_REPLAY_INDEX_SPECS.find(
    (candidate) => candidate.canonicalName === "idx_usage_ledger_session_identity"
  );

  test("builds the unfiltered ledger identity index concurrently", async () => {
    if (!hydrationSpec) throw new Error("missing 0117 identity index spec");
    const { executor, execute } = createFakeExecutor();

    await runSessionReplayIndexPreflight(executor, [hydrationSpec]);

    const createStatement = execute.mock.calls
      .map(([statement]) => statement)
      .find((statement) => statement.startsWith("CREATE INDEX CONCURRENTLY"));
    expect(createStatement).toContain(`"${hydrationSpec.temporaryName}"`);
    expect(createStatement).toContain(hydrationSpec.definition);
    expect(createStatement).not.toContain("WHERE");
  });

  test("builds and validates a temporary index before replacing the canonical index", async () => {
    const { executor, execute, states } = createFakeExecutor({
      [spec.canonicalName]: { exists: true, valid: true, marker: null },
    });

    await runSessionReplayIndexPreflight(executor, [spec]);

    expect(states.get(spec.canonicalName)).toEqual({
      exists: true,
      valid: true,
      marker: spec.marker,
    });
    expect(states.has(spec.temporaryName)).toBe(false);

    const sql = execute.mock.calls.map(([statement]) => statement);
    const createAt = sql.findIndex((statement) =>
      statement.startsWith("CREATE INDEX CONCURRENTLY")
    );
    const dropAt = sql.findIndex((statement) =>
      statement.includes(`DROP INDEX CONCURRENTLY IF EXISTS "public"."${spec.canonicalName}"`)
    );
    const renameAt = sql.findIndex((statement) =>
      statement.includes(`ALTER INDEX "public"."${spec.temporaryName}" RENAME TO`)
    );
    expect(createAt).toBeGreaterThanOrEqual(0);
    expect(dropAt).toBeGreaterThan(createAt);
    expect(renameAt).toBeGreaterThan(dropAt);
  });

  test("resumes by renaming a previously validated temporary index", async () => {
    const { executor, execute, states } = createFakeExecutor({
      [spec.temporaryName]: {
        exists: true,
        valid: true,
        marker: spec.marker,
      },
    });

    await runSessionReplayIndexPreflight(executor, [spec]);

    expect(states.get(spec.canonicalName)?.marker).toBe(spec.marker);
    expect(execute.mock.calls.flat().some((sql) => sql.startsWith("CREATE INDEX"))).toBe(false);
  });

  test("keeps the old canonical index when the concurrent build fails", async () => {
    const { executor, execute, states } = createFakeExecutor({
      [spec.canonicalName]: { exists: true, valid: true, marker: null },
    });
    execute.mockImplementationOnce(async () => undefined);
    execute.mockImplementationOnce(async () => undefined);
    execute.mockImplementationOnce(async () => undefined);
    execute.mockImplementationOnce(async () => {
      throw new Error("concurrent build failed");
    });

    await expect(runSessionReplayIndexPreflight(executor, [spec])).rejects.toThrow(
      "concurrent build failed"
    );
    expect(states.get(spec.canonicalName)).toEqual({
      exists: true,
      valid: true,
      marker: null,
    });
    expect(
      execute.mock.calls
        .flat()
        .some((sql) => sql.includes(`DROP INDEX CONCURRENTLY IF EXISTS "${spec.canonicalName}"`))
    ).toBe(false);
  });

  test("keeps a validated canonical index and only removes a stale temp", async () => {
    const { executor, execute, states } = createFakeExecutor({
      [spec.canonicalName]: {
        exists: true,
        valid: true,
        marker: spec.marker,
      },
      [spec.temporaryName]: { exists: true, valid: false, marker: null },
    });

    await runSessionReplayIndexPreflight(executor, [spec]);

    expect(states.get(spec.canonicalName)?.marker).toBe(spec.marker);
    expect(states.has(spec.temporaryName)).toBe(false);
    expect(
      execute.mock.calls
        .flat()
        .some((sql) => sql.includes(`DROP INDEX CONCURRENTLY IF EXISTS "${spec.canonicalName}"`))
    ).toBe(false);
  });

  test("postflight reconciles indexes without reacquiring table DDL locks", async () => {
    const { executor, execute } = createFakeExecutor({
      [spec.canonicalName]: {
        exists: true,
        valid: true,
        marker: spec.marker,
      },
    });

    await runSessionReplayIndexPreflight(executor, [spec], { ensureColumns: false });

    const statements = execute.mock.calls.map(([statement]) => statement);
    expect(statements.some((statement) => statement.includes("ALTER TABLE"))).toBe(false);
    expect(statements.some((statement) => statement.includes("lock_timeout"))).toBe(false);
  });

  test("adds pre-0116 Replay columns before building timeout indexes", async () => {
    const { executor, execute } = createFakeExecutor();

    await runSessionReplayIndexPreflight(executor, [spec]);

    const statements = execute.mock.calls.map(([statement]) => statement);
    const ensureColumns = statements.find((statement) => statement.includes("ALTER TABLE"));
    const createIndexAt = statements.findIndex((statement) =>
      statement.startsWith("CREATE INDEX CONCURRENTLY")
    );
    const ensureColumnsAt = ensureColumns ? statements.indexOf(ensureColumns) : -1;

    expect(ensureColumns).toContain('ALTER TABLE "message_request"');
    expect(ensureColumns).toContain(
      'ADD COLUMN IF NOT EXISTS "is_replay" boolean DEFAULT false NOT NULL'
    );
    expect(ensureColumnsAt).toBeGreaterThanOrEqual(0);
    expect(createIndexAt).toBeGreaterThan(ensureColumnsAt);
  });

  test("keeps validated v1 indexes while upgrading only the v2 timeout indexes", async () => {
    const legacySpec = SESSION_REPLAY_INDEX_SPECS.find(
      (candidate) => candidate.marker === SESSION_REPLAY_INDEX_MARKER
    );
    if (!legacySpec) throw new Error("missing v1 index spec");
    const { executor, execute } = createFakeExecutor({
      [legacySpec.canonicalName]: {
        exists: true,
        valid: true,
        marker: SESSION_REPLAY_INDEX_MARKER,
      },
      [spec.canonicalName]: {
        exists: true,
        valid: true,
        marker: SESSION_REPLAY_INDEX_MARKER,
      },
    });

    await runSessionReplayIndexPreflight(executor, [legacySpec, spec]);

    const createStatements = execute.mock.calls
      .map(([statement]) => statement)
      .filter((statement) => statement.startsWith("CREATE INDEX CONCURRENTLY"));
    expect(createStatements).toHaveLength(1);
    expect(createStatements[0]).toContain(spec.temporaryName);
    expect(createStatements[0]).not.toContain(legacySpec.temporaryName);
  });

  test("uses the v2 marker and public-qualified definitions for timeout indexes", () => {
    const timeoutSpecs = SESSION_REPLAY_INDEX_SPECS.filter(
      (candidate) => candidate.marker === DATABASE_TIMEOUT_INDEX_MARKER
    );

    expect(timeoutSpecs).toHaveLength(5);
    expect(
      timeoutSpecs.every((candidate) => candidate.temporaryName.startsWith("cch_0118_tmp_"))
    ).toBe(true);
    expect(timeoutSpecs.every((candidate) => candidate.definition.includes('ON "public".'))).toBe(
      true
    );
  });
});

describe("database index migration orchestration", () => {
  test("preflights the unfiltered ledger identity index before migration 0117", async () => {
    const events: string[] = [];
    await runSessionReplayMigrationPlan({
      baseTablesReady: true,
      latestMigrationCreatedAt: 1785563419224,
      migrate: async () => events.push("migrate"),
      runIndexPreflight: async () => events.push("preflight"),
    });

    expect(events).toEqual(["preflight", "migrate", "preflight"]);
  });
  test("migrates a fresh database before installing concurrent indexes", async () => {
    const calls: string[] = [];

    await runSessionReplayMigrationPlan({
      baseTablesReady: false,
      latestMigrationCreatedAt: null,
      migrate: async () => {
        calls.push("migrate");
      },
      runIndexPreflight: async () => {
        calls.push("indexes");
      },
    });

    expect(calls).toEqual(["migrate", "indexes"]);
  });

  test("prebuilds indexes for an existing upgrade and verifies them after migration", async () => {
    const calls: string[] = [];

    await runSessionReplayMigrationPlan({
      baseTablesReady: true,
      latestMigrationCreatedAt: SESSION_REPLAY_MIGRATION_CREATED_AT - 1,
      migrate: async () => {
        calls.push("migrate");
      },
      runIndexPreflight: async () => {
        calls.push("indexes");
      },
    });

    expect(calls).toEqual(["indexes", "migrate", "indexes"]);
  });

  test("preflights the new identity index after migration 0116 was recorded", async () => {
    const calls: string[] = [];

    await runSessionReplayMigrationPlan({
      baseTablesReady: true,
      latestMigrationCreatedAt: SESSION_REPLAY_MIGRATION_CREATED_AT,
      migrate: async () => {
        calls.push("migrate");
      },
      runIndexPreflight: async () => {
        calls.push("indexes");
      },
    });

    expect(calls).toEqual(["indexes", "migrate", "indexes"]);
  });

  test("prebuilds timeout indexes before upgrading an existing 0117 database", async () => {
    const calls: string[] = [];

    await runSessionReplayMigrationPlan({
      baseTablesReady: true,
      latestMigrationCreatedAt: DATABASE_TIMEOUT_INDEX_MIGRATION_CREATED_AT - 1,
      migrate: async () => calls.push("migrate"),
      runIndexPreflight: async () => calls.push("indexes"),
    });

    expect(calls).toEqual(["indexes", "migrate", "indexes"]);
  });

  test("runs only postflight after migration 0118 is already recorded", async () => {
    const calls: string[] = [];

    await runSessionReplayMigrationPlan({
      baseTablesReady: true,
      latestMigrationCreatedAt: DATABASE_TIMEOUT_INDEX_MIGRATION_CREATED_AT,
      migrate: async () => calls.push("migrate"),
      runIndexPreflight: async () => calls.push("indexes"),
    });

    expect(calls).toEqual(["migrate", "indexes"]);
  });

  test("fails the migration flow when concurrent index postflight fails", async () => {
    await expect(
      runSessionReplayMigrationPlan({
        baseTablesReady: false,
        latestMigrationCreatedAt: null,
        migrate: async () => undefined,
        runIndexPreflight: async () => {
          throw new Error("concurrent build failed");
        },
      })
    ).rejects.toThrow("concurrent build failed");
  });
});
