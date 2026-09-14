import { readdirSync, readFileSync } from "node:fs";
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

  it("does not run the accounting projection for routing-trace-only updates", () => {
    expect(sql).toContain("AFTER INSERT OR UPDATE OF");
    expect(sql).not.toMatch(/UPDATE OF[\s\S]*routing_trace[\s\S]*ON message_request/);
  });

  it("projects Session identity and Replay provenance through insert and upsert", () => {
    const projectionFields = [
      "session_identity",
      "session_identity_kind",
      "affinity_scope_tag",
      "affinity_fingerprint",
      "affinity_fingerprint_chain",
      "is_replay",
      "replay_source_request_id",
    ];

    for (const field of projectionFields) {
      expect(sql).toMatch(new RegExp(`INSERT INTO usage_ledger \\([\\s\\S]*${field}`));
      expect(sql).toContain(`NEW.${field}`);
      expect(sql).toContain(`${field} = EXCLUDED.${field}`);
      expect(sql).toMatch(new RegExp(`UPDATE OF[\\s\\S]*${field}[\\s\\S]*ON message_request`));
    }
  });

  it("forces Replay rows to zero cost at the ledger projection boundary", () => {
    expect(sql).toContain("CASE WHEN NEW.is_replay THEN 0 ELSE NEW.cost_usd END");
  });
});

function extractUpsertFunctionBody(source: string): string {
  const start = source.indexOf("CREATE OR REPLACE FUNCTION fn_upsert_usage_ledger()");
  const endMarker = "$$ LANGUAGE plpgsql;";
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source
    .slice(start, end + endMarker.length)
    .replace(/\s+/g, " ")
    .trim();
}

function extractTriggerColumns(source: string): string[] {
  const match = source.match(/AFTER INSERT OR UPDATE OF([\s\S]*?)ON message_request/);
  expect(match).not.toBeNull();
  return (match?.[1] ?? "")
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

function extractGateColumns(source: string, prefix: "NEW" | "OLD"): string[] {
  const gate = source.slice(source.indexOf("Gate 2"), source.indexOf("v_success_rate_outcome :="));
  const pattern = new RegExp(
    `ROW\\(\\s*(${prefix}\\.[\\s\\S]*?)\\)\\s*(?:IS NOT DISTINCT FROM|THEN)`
  );
  const match = gate.match(pattern);
  expect(match).not.toBeNull();
  return (match?.[1] ?? "").split(",").map((column) => column.trim().replace(`${prefix}.`, ""));
}

describe("fn_upsert_usage_ledger terminal projection gates", () => {
  it("returns before any ledger write for rows that are not finalized", () => {
    const body = extractUpsertFunctionBody(sql);
    const gateIndex = body.indexOf("IF NOT fn_is_message_request_finalized( NEW.blocked_by");
    expect(gateIndex).toBeGreaterThan(0);
    expect(gateIndex).toBeLessThan(body.indexOf("INSERT INTO usage_ledger"));
    expect(gateIndex).toBeLessThan(body.indexOf("UPDATE usage_ledger"));
    expect(gateIndex).toBeLessThan(body.indexOf("DELETE FROM usage_ledger"));
  });

  it("skips updates whose projected columns are unchanged, comparing exactly the trigger columns", () => {
    const triggerColumns = extractTriggerColumns(sql);
    expect(sql).toContain("IS NOT DISTINCT FROM");
    expect(extractGateColumns(sql, "NEW")).toEqual(triggerColumns);
    expect(extractGateColumns(sql, "OLD")).toEqual(triggerColumns);
  });

  it("keeps the early return for warmup and non-billing endpoints on INSERT", () => {
    const body = extractUpsertFunctionBody(sql);
    expect(body).toContain("IF NEW.blocked_by = 'warmup' THEN -- If a ledger row already exists");
    expect(body).toMatch(
      /IF TG_OP = 'UPDATE' THEN UPDATE usage_ledger SET blocked_by = 'warmup'[\s\S]*?END IF; RETURN NEW; END IF;/
    );
    expect(body).toMatch(
      /IF TG_OP = 'UPDATE' THEN DELETE FROM usage_ledger WHERE request_id = NEW.id; END IF; RETURN NEW; END IF;/
    );
  });

  it("ships the same function body in the newest migration that defines it", () => {
    const migrationsDir = resolve(process.cwd(), "drizzle");
    const definingMigrations = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .filter((file) =>
        readFileSync(resolve(migrationsDir, file), "utf-8").includes(
          "CREATE OR REPLACE FUNCTION fn_upsert_usage_ledger()"
        )
      );
    const newest = definingMigrations.at(-1);
    expect(newest).toBeDefined();
    const migration = readFileSync(resolve(migrationsDir, newest as string), "utf-8");

    expect(extractUpsertFunctionBody(migration)).toBe(extractUpsertFunctionBody(sql));
    expect(extractTriggerColumns(migration)).toEqual(extractTriggerColumns(sql));
  });
});
