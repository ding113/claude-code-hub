import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "src/lib/ledger-backfill/trigger.sql"), "utf-8");

describe("fn_upsert_usage_ledger trigger SQL", () => {
  it("contains warmup exclusion check", () => {
    expect(sql).toContain("blocked_by = 'warmup'");
  });

  it("contains ON CONFLICT UPSERT", () => {
    expect(sql).toContain("ON CONFLICT (request_id) DO UPDATE");
  });

  it("contains EXCEPTION error handling", () => {
    expect(sql).toContain("EXCEPTION WHEN OTHERS");
  });

  it("pre-validates provider_chain before extraction", () => {
    expect(sql).toContain("jsonb_typeof");
  });

  it("computes is_success from error_message", () => {
    expect(sql).toContain("error_message IS NULL");
  });

  it("skips irrelevant updates to reduce write amplification", () => {
    expect(sql).toContain("TG_OP = 'UPDATE'");
    expect(sql).toContain("IS NOT DISTINCT FROM");
    // Ensure the skip logic compares derived values (usage_ledger doesn't persist provider_chain / error_message)
    expect(sql).toContain("v_final_provider_id IS NOT DISTINCT FROM v_old_final_provider_id");
    expect(sql).toContain("v_is_success IS NOT DISTINCT FROM v_old_is_success");
  });

  it("creates trigger binding", () => {
    expect(sql).toContain("CREATE TRIGGER trg_upsert_usage_ledger");
  });
});
