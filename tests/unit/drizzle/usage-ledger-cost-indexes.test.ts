import type { SQL } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { usageLedger } from "@/drizzle/schema";

/**
 * Regression guard for the index-only-scan regression introduced by #1091.
 *
 * `LEDGER_BILLING_CONDITION` filters `usage_ledger` on `endpoint` (it excludes
 * non-billing endpoints such as count_tokens / compact). The hot-path
 * `SUM(cost_usd)` queries -- rate-limit checks and the Quotas page
 * (`sumUserTotalCost` / `sumKeyTotalCost` / `sumProviderTotalCost` /
 * `sumUserQuotaCosts` ...) -- only stay on an Index Only Scan if `endpoint`
 * is covered by these indexes. Without it the planner abandons the covering
 * index and degrades to a Bitmap Heap Scan (one heap fetch per matching row).
 */
describe("usage_ledger cost covering indexes", () => {
  const { indexes } = getTableConfig(usageLedger);

  const indexColumns = (name: string): string[] => {
    const index = indexes.find((entry) => entry.config.name === name);
    if (!index) {
      throw new Error(`index "${name}" not found on usage_ledger`);
    }
    return index.config.columns.map((column) => {
      const columnName = (column as { name?: unknown }).name;
      return typeof columnName === "string" ? columnName : "";
    });
  };

  const indexPredicate = (name: string): string => {
    const index = indexes.find((entry) => entry.config.name === name);
    if (!index?.config.where) {
      throw new Error(`index "${name}" has no predicate`);
    }
    return (index.config.where as SQL)
      .toQuery({
        escapeName: (value) => `"${value}"`,
        escapeParam: (num) => `$${num}`,
        escapeString: (value) => `'${value}'`,
        casing: new CasingCache(),
        paramStartIndex: { value: 1 },
      })
      .sql.toLowerCase();
  };

  it.each([
    ["idx_usage_ledger_user_cost_cover", ["user_id", "created_at", "cost_usd", "endpoint"]],
    [
      "idx_usage_ledger_provider_cost_cover",
      ["final_provider_id", "created_at", "cost_usd", "endpoint"],
    ],
    ["idx_usage_ledger_key_cost", ["key", "created_at", "cost_usd", "endpoint"]],
  ])("%s keeps endpoint as a trailing column so SUM(cost_usd) stays index-only", (name, expected) => {
    expect(indexColumns(name)).toEqual(expected);
  });

  it.each([
    "idx_usage_ledger_user_created_at",
    "idx_usage_ledger_key_created_at",
    "idx_usage_ledger_provider_created_at",
    "idx_usage_ledger_key_cost",
    "idx_usage_ledger_user_cost_cover",
    "idx_usage_ledger_provider_cost_cover",
    "idx_usage_ledger_key_created_at_desc_cover",
  ])("%s excludes blocked and Replay audit rows", (name) => {
    const predicate = indexPredicate(name);
    expect(predicate).toContain('"usage_ledger"."blocked_by" is null');
    expect(predicate).toContain('"usage_ledger"."is_replay" = false');
  });
});
