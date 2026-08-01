import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0116_gigantic_zombie.sql"),
  "utf-8"
);

describe("0116 Session identity and Replay migration", () => {
  test.each(["message_request", "usage_ledger"])(
    "adds identity and Replay provenance to %s",
    (table) => {
      for (const column of [
        "session_identity",
        "session_identity_kind",
        "affinity_scope_tag",
        "affinity_fingerprint",
        "affinity_fingerprint_chain",
        "is_replay",
        "replay_source_request_id",
      ]) {
        expect(migration).toContain(
          `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}"`
        );
      }
    }
  );

  test("backfills existing ledger identity and Replay rows with zero cost", () => {
    expect(migration).toContain("WHERE blocked_by = 'replay_serve'");
    expect(migration).toContain("SET is_replay = true");
    expect(migration).toContain("UPDATE usage_ledger AS ul");
    expect(migration).toContain("ul.request_id = mr.id");
    expect(migration).toContain("is_replay = mr.is_replay");
    expect(migration).toContain("replay_source_request_id = mr.replay_source_request_id");
    expect(migration).toContain("CASE WHEN mr.is_replay THEN 0 ELSE ul.cost_usd END");
  });

  test("installs the updated projection function and trigger columns", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION fn_upsert_usage_ledger()");
    expect(migration).toContain("CASE WHEN NEW.is_replay THEN 0 ELSE NEW.cost_usd END");
    expect(migration).toMatch(
      /AFTER INSERT OR UPDATE OF[\s\S]*session_identity[\s\S]*is_replay[\s\S]*replay_source_request_id[\s\S]*ON message_request/
    );
  });

  test("creates the identity and Replay-aware billing indexes idempotently", () => {
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_message_request_session_identity_created_at"'
    );
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_usage_ledger_session_identity_created_at"'
    );
    expect(migration).toContain('"usage_ledger"."is_replay" = false');
    expect(migration).not.toMatch(/^CREATE INDEX (?!IF NOT EXISTS)/m);
  });

  test("preserves concurrently prebuilt 0116 indexes through marker guards", () => {
    expect(migration).toContain("cch:migration:0116:session-replay-index:v1");
    expect(migration).toContain("obj_description");
    expect(migration).not.toMatch(/^DROP INDEX IF EXISTS/m);
  });
});
