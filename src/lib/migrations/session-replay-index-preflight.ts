export const SESSION_REPLAY_MIGRATION_CREATED_AT = 1785563419224;
export const SESSION_IDENTITY_INDEX_MIGRATION_CREATED_AT = 1785635169798;
export const DATABASE_TIMEOUT_INDEX_MIGRATION_CREATED_AT = 1785688550789;
export const SESSION_REPLAY_INDEX_MARKER = "cch:migration:0116:session-replay-index:v1";
export const DATABASE_TIMEOUT_INDEX_MARKER = "cch:migration:0118:database-timeout-index:v2";

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
  marker: string;
  definition: string;
};

export const SESSION_REPLAY_INDEX_SPECS: readonly SessionReplayIndexSpec[] = [
  {
    canonicalName: "idx_message_request_session_identity_created_at",
    temporaryName: "cch_0118_tmp_01",
    marker: DATABASE_TIMEOUT_INDEX_MARKER,
    definition:
      'ON "public"."message_request" USING btree (COALESCE("session_identity", "session_id"),"created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "message_request"."deleted_at" IS NULL',
  },
  {
    canonicalName: "idx_usage_ledger_session_identity_created_at",
    temporaryName: "cch_0118_tmp_02",
    marker: DATABASE_TIMEOUT_INDEX_MARKER,
    definition:
      'ON "public"."usage_ledger" USING btree (COALESCE("session_identity", "session_id"),"user_id","created_at" DESC NULLS LAST) WHERE "usage_ledger"."blocked_by" IS NULL AND "usage_ledger"."is_replay" = false',
  },
  {
    canonicalName: "idx_message_request_proxy_status_active",
    temporaryName: "cch_0118_tmp_03",
    marker: DATABASE_TIMEOUT_INDEX_MARKER,
    definition:
      'ON "public"."message_request" USING btree ("created_at" DESC NULLS LAST,"user_id") WHERE "message_request"."deleted_at" IS NULL AND "message_request"."is_replay" = false AND "message_request"."status_code" IS NULL AND ("message_request"."blocked_by" IS NULL OR "message_request"."blocked_by" <> \'warmup\')',
  },
  {
    canonicalName: "idx_message_request_proxy_status_latest",
    temporaryName: "cch_0118_tmp_04",
    marker: DATABASE_TIMEOUT_INDEX_MARKER,
    definition:
      'ON "public"."message_request" USING btree ("user_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "message_request"."deleted_at" IS NULL AND "message_request"."is_replay" = false AND "message_request"."status_code" IS NOT NULL AND ("message_request"."blocked_by" IS NULL OR "message_request"."blocked_by" <> \'warmup\')',
  },
  {
    canonicalName: "idx_usage_ledger_user_id_reset",
    temporaryName: "cch_0118_tmp_05",
    marker: DATABASE_TIMEOUT_INDEX_MARKER,
    definition: 'ON "public"."usage_ledger" USING btree ("user_id")',
  },
  {
    canonicalName: "idx_usage_ledger_session_identity",
    temporaryName: "cch_0117_tmp_01",
    marker: SESSION_REPLAY_INDEX_MARKER,
    definition: 'ON "usage_ledger" USING btree (COALESCE("session_identity", "session_id"))',
  },
  {
    canonicalName: "idx_usage_ledger_user_created_at",
    temporaryName: "cch_0116_tmp_03",
    marker: SESSION_REPLAY_INDEX_MARKER,
    definition:
      'ON "usage_ledger" USING btree ("user_id","created_at") WHERE "usage_ledger"."blocked_by" IS NULL AND "usage_ledger"."is_replay" = false',
  },
  {
    canonicalName: "idx_usage_ledger_key_created_at",
    temporaryName: "cch_0116_tmp_04",
    marker: SESSION_REPLAY_INDEX_MARKER,
    definition:
      'ON "usage_ledger" USING btree ("key","created_at") WHERE "usage_ledger"."blocked_by" IS NULL AND "usage_ledger"."is_replay" = false',
  },
  {
    canonicalName: "idx_usage_ledger_provider_created_at",
    temporaryName: "cch_0116_tmp_05",
    marker: SESSION_REPLAY_INDEX_MARKER,
    definition:
      'ON "usage_ledger" USING btree ("final_provider_id","created_at") WHERE "usage_ledger"."blocked_by" IS NULL AND "usage_ledger"."is_replay" = false',
  },
  {
    canonicalName: "idx_usage_ledger_key_cost",
    temporaryName: "cch_0116_tmp_06",
    marker: SESSION_REPLAY_INDEX_MARKER,
    definition:
      'ON "usage_ledger" USING btree ("key","created_at","cost_usd","endpoint") WHERE "usage_ledger"."blocked_by" IS NULL AND "usage_ledger"."is_replay" = false',
  },
  {
    canonicalName: "idx_usage_ledger_user_cost_cover",
    temporaryName: "cch_0116_tmp_07",
    marker: SESSION_REPLAY_INDEX_MARKER,
    definition:
      'ON "usage_ledger" USING btree ("user_id","created_at","cost_usd","endpoint") WHERE "usage_ledger"."blocked_by" IS NULL AND "usage_ledger"."is_replay" = false',
  },
  {
    canonicalName: "idx_usage_ledger_provider_cost_cover",
    temporaryName: "cch_0116_tmp_08",
    marker: SESSION_REPLAY_INDEX_MARKER,
    definition:
      'ON "usage_ledger" USING btree ("final_provider_id","created_at","cost_usd","endpoint") WHERE "usage_ledger"."blocked_by" IS NULL AND "usage_ledger"."is_replay" = false',
  },
  {
    canonicalName: "idx_usage_ledger_key_created_at_desc_cover",
    temporaryName: "cch_0116_tmp_09",
    marker: SESSION_REPLAY_INDEX_MARKER,
    definition:
      'ON "usage_ledger" USING btree ("key","created_at" DESC NULLS LAST,"final_provider_id") WHERE "usage_ledger"."blocked_by" IS NULL AND "usage_ledger"."is_replay" = false',
  },
];

function isValidatedIndex(state: MigrationIndexState, marker: string): boolean {
  return state.exists && state.valid && state.marker === marker;
}

async function ensurePreflightColumns(executor: MigrationIndexPreflightExecutor): Promise<void> {
  await executor.execute("SET lock_timeout = '5s'");
  try {
    await executor.execute(`ALTER TABLE "message_request"
  ADD COLUMN IF NOT EXISTS "session_identity" varchar(64);
ALTER TABLE "message_request"
  ADD COLUMN IF NOT EXISTS "is_replay" boolean DEFAULT false NOT NULL;
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
  specs: readonly SessionReplayIndexSpec[] = SESSION_REPLAY_INDEX_SPECS,
  options: { ensureColumns?: boolean } = {}
): Promise<void> {
  if (options.ensureColumns !== false) {
    await ensurePreflightColumns(executor);
  }

  for (const spec of specs) {
    const canonical = await executor.inspectIndex(spec.canonicalName);
    if (isValidatedIndex(canonical, spec.marker)) {
      const staleTemp = await executor.inspectIndex(spec.temporaryName);
      if (staleTemp.exists) {
        await executor.execute(`DROP INDEX CONCURRENTLY IF EXISTS "${spec.temporaryName}"`);
      }
      continue;
    }

    let temporary = await executor.inspectIndex(spec.temporaryName);
    if (!isValidatedIndex(temporary, spec.marker)) {
      if (temporary.exists) {
        await executor.execute(`DROP INDEX CONCURRENTLY IF EXISTS "${spec.temporaryName}"`);
      }
      await executor.execute(
        `CREATE INDEX CONCURRENTLY "${spec.temporaryName}" ${spec.definition}`
      );
      await executor.execute(
        `COMMENT ON INDEX "public"."${spec.temporaryName}" IS '${spec.marker}'`
      );
      temporary = await executor.inspectIndex(spec.temporaryName);
      if (!isValidatedIndex(temporary, spec.marker)) {
        throw new Error(`Concurrent preflight produced an invalid index: ${spec.temporaryName}`);
      }
    }

    if (canonical.exists) {
      await executor.execute(`DROP INDEX CONCURRENTLY IF EXISTS "public"."${spec.canonicalName}"`);
    }
    await executor.execute(
      `ALTER INDEX "public"."${spec.temporaryName}" RENAME TO "${spec.canonicalName}"`
    );

    const replaced = await executor.inspectIndex(spec.canonicalName);
    if (!isValidatedIndex(replaced, spec.marker)) {
      throw new Error(`Concurrent preflight failed to install index: ${spec.canonicalName}`);
    }
  }
}

export async function runSessionReplayMigrationPlan(input: {
  baseTablesReady: boolean;
  latestMigrationCreatedAt: number | null;
  migrate(): Promise<void>;
  runIndexPreflight(options: { ensureColumns: boolean }): Promise<void>;
}): Promise<void> {
  const { baseTablesReady, latestMigrationCreatedAt, migrate, runIndexPreflight } = input;

  if (
    baseTablesReady &&
    (latestMigrationCreatedAt == null ||
      !Number.isFinite(latestMigrationCreatedAt) ||
      latestMigrationCreatedAt < DATABASE_TIMEOUT_INDEX_MIGRATION_CREATED_AT)
  ) {
    await runIndexPreflight({ ensureColumns: true });
  }

  await migrate();
  await runIndexPreflight({ ensureColumns: false });
}
