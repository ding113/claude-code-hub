import { describe, expect, test, vi } from "vitest";
import {
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

    const commentName = sql.match(/^COMMENT ON INDEX "([^"]+)"/)?.[1];
    if (commentName) {
      const state = states.get(commentName);
      if (!state) throw new Error(`missing index ${commentName}`);
      states.set(commentName, { ...state, marker: SESSION_REPLAY_INDEX_MARKER });
      return;
    }

    const dropName = sql.match(/^DROP INDEX CONCURRENTLY IF EXISTS "([^"]+)"/)?.[1];
    if (dropName) {
      states.delete(dropName);
      return;
    }

    const rename = sql.match(/^ALTER INDEX "([^"]+)" RENAME TO "([^"]+)"/)?.slice(1);
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

describe("0116 concurrent index preflight", () => {
  const spec = SESSION_REPLAY_INDEX_SPECS[0];

  test("builds and validates a temporary index before replacing the canonical index", async () => {
    const { executor, execute, states } = createFakeExecutor({
      [spec.canonicalName]: { exists: true, valid: true, marker: null },
    });

    await runSessionReplayIndexPreflight(executor, [spec]);

    expect(states.get(spec.canonicalName)).toEqual({
      exists: true,
      valid: true,
      marker: SESSION_REPLAY_INDEX_MARKER,
    });
    expect(states.has(spec.temporaryName)).toBe(false);

    const sql = execute.mock.calls.map(([statement]) => statement);
    const createAt = sql.findIndex((statement) =>
      statement.startsWith("CREATE INDEX CONCURRENTLY")
    );
    const dropAt = sql.findIndex((statement) =>
      statement.includes(`DROP INDEX CONCURRENTLY IF EXISTS "${spec.canonicalName}"`)
    );
    const renameAt = sql.findIndex((statement) =>
      statement.includes(`ALTER INDEX "${spec.temporaryName}" RENAME TO`)
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
        marker: SESSION_REPLAY_INDEX_MARKER,
      },
    });

    await runSessionReplayIndexPreflight(executor, [spec]);

    expect(states.get(spec.canonicalName)?.marker).toBe(SESSION_REPLAY_INDEX_MARKER);
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
        marker: SESSION_REPLAY_INDEX_MARKER,
      },
      [spec.temporaryName]: { exists: true, valid: false, marker: null },
    });

    await runSessionReplayIndexPreflight(executor, [spec]);

    expect(states.get(spec.canonicalName)?.marker).toBe(SESSION_REPLAY_INDEX_MARKER);
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
        marker: SESSION_REPLAY_INDEX_MARKER,
      },
    });

    await runSessionReplayIndexPreflight(executor, [spec], { ensureColumns: false });

    const statements = execute.mock.calls.map(([statement]) => statement);
    expect(statements.some((statement) => statement.includes("ALTER TABLE"))).toBe(false);
    expect(statements.some((statement) => statement.includes("lock_timeout"))).toBe(false);
  });
});

describe("0116 migration orchestration", () => {
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

  test("repairs indexes in postflight after migration 0116 was recorded", async () => {
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
