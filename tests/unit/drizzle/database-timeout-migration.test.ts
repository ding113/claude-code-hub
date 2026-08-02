import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0118_bright_sunspot.sql"),
  "utf-8"
);

describe("0118 database timeout indexes", () => {
  test.each([
    "idx_message_request_session_identity_created_at",
    "idx_usage_ledger_session_identity_created_at",
    "idx_message_request_proxy_status_active",
    "idx_message_request_proxy_status_latest",
    "idx_usage_ledger_user_id_reset",
  ])("keeps %s idempotent for fresh databases", (indexName) => {
    expect(migration).toContain(`CREATE INDEX IF NOT EXISTS "${indexName}"`);
  });

  test("does not drop or rebuild large indexes transactionally", () => {
    expect(migration).not.toMatch(/DROP\s+INDEX/i);
    expect(migration).not.toMatch(/CREATE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)/i);
  });

  test("records the approved Session and Proxy Status index shapes", () => {
    expect(migration).toContain(
      'COALESCE("session_identity", "session_id"),"created_at" DESC NULLS LAST,"id" DESC NULLS LAST'
    );
    expect(migration).toContain(
      'COALESCE("session_identity", "session_id"),"user_id","created_at" DESC NULLS LAST'
    );
    expect(migration).toContain('"created_at" DESC NULLS LAST,"user_id"');
    expect(migration).toContain(
      '"user_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST'
    );
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_usage_ledger_user_id_reset" ON "usage_ledger" USING btree ("user_id")'
    );
  });
});
