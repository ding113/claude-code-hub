import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 以实际部署的迁移 SQL 为准（trigger.sql 主要用于回填/参考，不一定与最终迁移完全一致）。
const sql = readFileSync(
  resolve(process.cwd(), "drizzle/0079_perf_usage_ledger_trigger_skip_blocked_rows.sql"),
  "utf-8"
);

describe("fn_upsert_usage_ledger migration SQL", () => {
  it("contains warmup exclusion check", () => {
    expect(sql).toContain("blocked_by = 'warmup'");
  });

  it("skips blocked requests to avoid wasted ledger writes", () => {
    expect(sql).toContain("NEW.blocked_by IS NOT NULL");
    expect(sql).toContain("UPDATE usage_ledger SET blocked_by = NEW.blocked_by");
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
    // Self-heal: if ledger row is missing, later UPDATE can fill it (avoids permanent gaps)
    expect(sql).toContain("EXISTS (SELECT 1 FROM usage_ledger WHERE request_id = NEW.id)");
  });

  it("creates function definition", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION fn_upsert_usage_ledger");
  });
});
