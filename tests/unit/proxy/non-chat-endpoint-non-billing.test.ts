import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NON_BILLING_ENDPOINTS, isNonBillingEndpoint } from "@/lib/utils/performance-formatter";

const ledgerConditionsSource = readFileSync(
  resolve(process.cwd(), "src/repository/_shared/ledger-conditions.ts"),
  "utf-8"
);
const backfillSource = readFileSync(
  resolve(process.cwd(), "src/lib/ledger-backfill/service.ts"),
  "utf-8"
);
const triggerSqlSource = readFileSync(
  resolve(process.cwd(), "src/lib/ledger-backfill/trigger.sql"),
  "utf-8"
);
const nonBillingMigrationFile = readdirSync(resolve(process.cwd(), "drizzle")).find((file) =>
  /_equal_selene\.sql$/.test(file)
);
if (!nonBillingMigrationFile) {
  throw new Error("Expected to find the non-chat fallback Drizzle migration file");
}
const migrationSource = readFileSync(
  resolve(process.cwd(), "drizzle", nonBillingMigrationFile),
  "utf-8"
);
const sharedBillingConsumerSources = [
  "src/repository/message.ts",
  "src/repository/statistics.ts",
  "src/repository/usage-ledger.ts",
  "src/repository/overview.ts",
  "src/repository/leaderboard.ts",
  "src/actions/my-usage.ts",
].map((relativePath) => ({
  relativePath,
  source: readFileSync(resolve(process.cwd(), relativePath), "utf-8"),
}));

describe("non-chat endpoint non-billing parity", () => {
  it("fallback success for target raw endpoints does not create billable ledger usage", () => {
    expect(ledgerConditionsSource).toContain("NON_BILLING_ENDPOINTS");
    expect(ledgerConditionsSource).toContain("LEDGER_BILLING_CONDITION");
    expect(ledgerConditionsSource).toContain("NOT IN");
  });

  it("formatter treats count tokens and compact as non-billing endpoints", () => {
    expect(NON_BILLING_ENDPOINTS).toEqual(["/v1/messages/count_tokens", "/v1/responses/compact"]);
    expect(isNonBillingEndpoint("/v1/messages/count_tokens")).toBe(true);
    expect(isNonBillingEndpoint("/v1/messages/count_tokens/")).toBe(true);
    expect(isNonBillingEndpoint("/v1/responses/compact")).toBe(true);
    expect(isNonBillingEndpoint("/v1/responses/compact/")).toBe(true);
    expect(isNonBillingEndpoint("/v1/messages")).toBe(false);
  });

  it("ledger backfill skips count tokens and compact message requests", () => {
    expect(backfillSource).toContain("/v1/messages/count_tokens");
    expect(backfillSource).toContain("/v1/responses/compact");
    expect(backfillSource).toContain("REGEXP_REPLACE");
    expect(triggerSqlSource).toContain("/v1/messages/count_tokens");
    expect(triggerSqlSource).toContain("/v1/responses/compact");
    expect(triggerSqlSource).toContain("REGEXP_REPLACE");
    expect(migrationSource).toContain("CREATE OR REPLACE FUNCTION fn_upsert_usage_ledger()");
    expect(migrationSource).toContain("/v1/messages/count_tokens");
    expect(migrationSource).toContain("/v1/responses/compact");
    expect(migrationSource).toContain("REGEXP_REPLACE");
  });

  it("overview leaderboard and my-usage consumers exclude target endpoints from billable views", () => {
    for (const { relativePath, source } of sharedBillingConsumerSources) {
      expect(source, `${relativePath} should continue using shared billing predicate`).toContain(
        "LEDGER_BILLING_CONDITION"
      );
    }
  });
});
