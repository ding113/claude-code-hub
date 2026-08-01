export const SESSION_REPLAY_MIGRATION_CREATED_AT = 1785563419224;
export const SESSION_REPLAY_INDEX_MARKER = "cch:migration:0116:session-replay-index:v1";

export type MigrationIndexState = {
  exists: boolean;
  valid: boolean;
  marker: string | null;
};

export type MigrationIndexPreflightExecutor = {
  execute(sql: string): Promise<void>;
  inspectIndex(name: string): Promise<MigrationIndexState>;
};

export type SessionReplayIndexSpec = {
  canonicalName: string;
  temporaryName: string;
  definition: string;
};

export const SESSION_REPLAY_INDEX_SPECS: readonly SessionReplayIndexSpec[] = [
  {
    canonicalName: "idx_message_request_session_identity_created_at",
    temporaryName: "cch_0116_tmp_01",
    definition:
      'ON "message_request" USING btree (COALESCE("session_identity", "session_id"),"created_at" DESC NULLS LAST) WHERE "message_request"."deleted_at" IS NULL',
  },
  {
    canonicalName: "idx_usage_ledger_session_identity_created_at",
    temporaryName: "cch_0116_tmp_02",
    definition:
      'ON "usage_ledger" USING btree (COALESCE("session_identity", "session_id"),"created_at" DESC NULLS LAST) WHERE "usage_ledger"."blocked_by" IS NULL AND "usage_ledger"."is_replay" = false',
  },
  {
    canonicalName: "idx_usage_ledger_user_created_at",
    temporaryName: "cch_0116_tmp_03",
    definition:
      'ON "usage_ledger" USING btree ("user_id","created_at") WHERE "usage_ledger"."blocked_by" IS NULL AND "usage_ledger"."is_replay" = false',
  },
  {
    canonicalName: "idx_usage_ledger_key_created_at",
    temporaryName: "cch_0116_tmp_04",
    definition:
      'ON "usage_ledger" USING btree ("key","created_at") WHERE "usage_ledger"."blocked_by" IS NULL AND "usage_ledger"."is_replay" = false',
  },
  {
    canonicalName: "idx_usage_ledger_provider_created_at",
    temporaryName: "cch_0116_tmp_05",
    definition:
      'ON "usage_ledger" USING btree ("final_provider_id","created_at") WHERE "usage_ledger"."blocked_by" IS NULL AND "usage_ledger"."is_replay" = false',
  },
  {
    canonicalName: "idx_usage_ledger_key_cost",
    temporaryName: "cch_0116_tmp_06",
    definition:
      'ON "usage_ledger" USING btree ("key","created_at","cost_usd","endpoint") WHERE "usage_ledger"."blocked_by" IS NULL AND "usage_ledger"."is_replay" = false',
  },
  {
    canonicalName: "idx_usage_ledger_user_cost_cover",
    temporaryName: "cch_0116_tmp_07",
    definition:
      'ON "usage_ledger" USING btree ("user_id","created_at","cost_usd","endpoint") WHERE "usage_ledger"."blocked_by" IS NULL AND "usage_ledger"."is_replay" = false',
  },
  {
    canonicalName: "idx_usage_ledger_provider_cost_cover",
    temporaryName: "cch_0116_tmp_08",
    definition:
      'ON "usage_ledger" USING btree ("final_provider_id","created_at","cost_usd","endpoint") WHERE "usage_ledger"."blocked_by" IS NULL AND "usage_ledger"."is_replay" = false',
  },
  {
    canonicalName: "idx_usage_ledger_key_created_at_desc_cover",
    temporaryName: "cch_0116_tmp_09",
    definition:
      'ON "usage_ledger" USING btree ("key","created_at" DESC NULLS LAST,"final_provider_id") WHERE "usage_ledger"."blocked_by" IS NULL AND "usage_ledger"."is_replay" = false',
  },
];

function isValidated0116Index(state: MigrationIndexState): boolean {
  return state.exists && state.valid && state.marker === SESSION_REPLAY_INDEX_MARKER;
}

async function ensurePreflightColumns(executor: MigrationIndexPreflightExecutor): Promise<void> {
  await executor.execute("SET lock_timeout = '5s'");
  try {
    await executor.execute(`ALTER TABLE "message_request"
  ADD COLUMN IF NOT EXISTS "session_identity" varchar(64);
ALTER TABLE "usage_ledger"
  ADD COLUMN IF NOT EXISTS "session_identity" varchar(64);
ALTER TABLE "usage_ledger"
  ADD COLUMN IF NOT EXISTS "is_replay" boolean DEFAULT false NOT NULL`);
  } finally {
    await executor.execute("RESET lock_timeout");
  }
}

export async function runSessionReplayIndexPreflight(
  executor: MigrationIndexPreflightExecutor,
  specs: readonly SessionReplayIndexSpec[] = SESSION_REPLAY_INDEX_SPECS
): Promise<void> {
  await ensurePreflightColumns(executor);

  for (const spec of specs) {
    const canonical = await executor.inspectIndex(spec.canonicalName);
    if (isValidated0116Index(canonical)) {
      const staleTemp = await executor.inspectIndex(spec.temporaryName);
      if (staleTemp.exists) {
        await executor.execute(`DROP INDEX CONCURRENTLY IF EXISTS "${spec.temporaryName}"`);
      }
      continue;
    }

    let temporary = await executor.inspectIndex(spec.temporaryName);
    if (!isValidated0116Index(temporary)) {
      if (temporary.exists) {
        await executor.execute(`DROP INDEX CONCURRENTLY IF EXISTS "${spec.temporaryName}"`);
      }
      await executor.execute(
        `CREATE INDEX CONCURRENTLY "${spec.temporaryName}" ${spec.definition}`
      );
      await executor.execute(
        `COMMENT ON INDEX "${spec.temporaryName}" IS '${SESSION_REPLAY_INDEX_MARKER}'`
      );
      temporary = await executor.inspectIndex(spec.temporaryName);
      if (!isValidated0116Index(temporary)) {
        throw new Error(`0116 preflight produced an invalid index: ${spec.temporaryName}`);
      }
    }

    if (canonical.exists) {
      await executor.execute(`DROP INDEX CONCURRENTLY IF EXISTS "${spec.canonicalName}"`);
    }
    await executor.execute(`ALTER INDEX "${spec.temporaryName}" RENAME TO "${spec.canonicalName}"`);

    const replaced = await executor.inspectIndex(spec.canonicalName);
    if (!isValidated0116Index(replaced)) {
      throw new Error(`0116 preflight failed to install index: ${spec.canonicalName}`);
    }
  }
}

export async function runPendingSessionReplayIndexPreflight(
  executor: MigrationIndexPreflightExecutor,
  latestMigrationCreatedAt: number | null
): Promise<void> {
  if (
    latestMigrationCreatedAt != null &&
    Number.isFinite(latestMigrationCreatedAt) &&
    latestMigrationCreatedAt >= SESSION_REPLAY_MIGRATION_CREATED_AT
  ) {
    return;
  }

  await runSessionReplayIndexPreflight(executor);
}
