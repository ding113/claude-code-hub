import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "src/lib/ledger-backfill/trigger.sql"), "utf-8");

describe("fn_upsert_usage_ledger trigger SQL", () => {
  it("defines shared request outcome helpers", () => {
    expect(sql).toContain("fn_compute_message_request_success_rate_outcome");
    expect(sql).toContain("fn_is_message_request_finalized");
  });

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

  it("persists success_rate_outcome into usage_ledger", () => {
    expect(sql).toContain("success_rate_outcome");
  });

  it("creates trigger binding", () => {
    expect(sql).toContain("CREATE TRIGGER trg_upsert_usage_ledger");
  });
});
