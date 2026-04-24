import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";
import { messageRequest, usageLedger } from "@/drizzle/schema";
import {
  buildDefaultHiddenUsageLogEndpointCondition,
  DEFAULT_HIDDEN_USAGE_LOG_ENDPOINTS,
  buildUsageLogConditions,
  shouldHideUsageLogEndpointsByDefault,
} from "@/repository/_shared/usage-log-filters";

const usageLogFiltersSource = readFileSync(
  resolve(process.cwd(), "src/repository/_shared/usage-log-filters.ts"),
  "utf-8"
);
const usageLogsSource = readFileSync(
  resolve(process.cwd(), "src/repository/usage-logs.ts"),
  "utf-8"
);

function sqlToQuery(sqlObj: SQL): { sql: string; params: unknown[] } {
  return sqlObj.toQuery({
    escapeName: (name: string) => `"${name}"`,
    escapeParam: (num: number) => `$${num}`,
    escapeString: (value: string) => `'${value}'`,
    casing: new CasingCache(),
    paramStartIndex: { value: 1 },
  });
}

function sqlToString(sqlObj: SQL): string {
  return sqlToQuery(sqlObj).sql;
}

describe("usage logs hidden non-chat endpoints", () => {
  it("default usage log queries hide target raw endpoints", () => {
    expect(DEFAULT_HIDDEN_USAGE_LOG_ENDPOINTS).toEqual([
      "/v1/messages/count_tokens",
      "/v1/responses/compact",
    ]);
    expect(shouldHideUsageLogEndpointsByDefault(undefined)).toBe(true);
    expect(shouldHideUsageLogEndpointsByDefault("")).toBe(true);
  });

  it("explicit endpoint filter reveals target raw endpoints and keeps filter options intact", () => {
    expect(shouldHideUsageLogEndpointsByDefault("/v1/messages/count_tokens")).toBe(false);
    expect(shouldHideUsageLogEndpointsByDefault("/v1/responses/compact")).toBe(false);

    const getUsedEndpointsSegment = usageLogsSource.slice(
      usageLogsSource.indexOf("export async function getUsedEndpoints"),
      usageLogsSource.indexOf("export interface UsageLogSessionIdSuggestionFilters")
    );
    const getDistinctEndpointsSegment = usageLogsSource.slice(
      usageLogsSource.indexOf("export async function getDistinctEndpointsForKey"),
      usageLogsSource.indexOf("export async function findUsageLogsWithDetails")
    );

    expect(getUsedEndpointsSegment).not.toContain("buildDefaultHiddenUsageLogEndpointCondition");
    expect(getDistinctEndpointsSegment).not.toContain(
      "buildDefaultHiddenUsageLogEndpointCondition"
    );
  });

  it("default hidden predicate covers ledger fallback queries", () => {
    const messageDefaultQuery = sqlToQuery(buildUsageLogConditions({})[0]);
    const ledgerDefaultQuery = sqlToQuery(
      buildDefaultHiddenUsageLogEndpointCondition(usageLedger.endpoint, undefined) as SQL
    );
    const messageDefaultSql = messageDefaultQuery.sql.toLowerCase();
    const ledgerDefaultSql = ledgerDefaultQuery.sql.toLowerCase();

    expect(messageDefaultSql).toContain("not in");
    expect(messageDefaultSql).toContain("regexp_replace");
    expect(messageDefaultQuery.params).toEqual([
      "/v1/messages/count_tokens",
      "/v1/responses/compact",
    ]);
    expect(ledgerDefaultSql).toContain("not in");
    expect(ledgerDefaultSql).toContain("regexp_replace");
    expect(ledgerDefaultQuery.params).toEqual([
      "/v1/messages/count_tokens",
      "/v1/responses/compact",
    ]);
  });

  it("explicit endpoint filter disables default hidden predicate and adds exact endpoint condition", () => {
    const explicitConditions = buildUsageLogConditions({ endpoint: "/v1/responses/compact" });
    const explicitQueries = explicitConditions.map(sqlToQuery);
    const explicitSql = explicitQueries
      .map((query) => query.sql)
      .join("\n")
      .toLowerCase();

    expect(explicitConditions).toHaveLength(1);
    expect(explicitSql).toContain("message_request");
    expect(explicitQueries.flatMap((query) => query.params)).toEqual(["/v1/responses/compact"]);
    expect(explicitSql).not.toContain("not in");
  });

  it("key scoped usage log queries still call the shared default hidden predicate", () => {
    expect(usageLogFiltersSource).toContain("DEFAULT_HIDDEN_USAGE_LOG_ENDPOINTS");
    expect(
      sqlToQuery(buildDefaultHiddenUsageLogEndpointCondition(messageRequest.endpoint, null) as SQL)
        .params
    ).toEqual(["/v1/messages/count_tokens", "/v1/responses/compact"]);
    expect(usageLogsSource).toContain("hiddenLedgerEndpointCondition");
    expect(usageLogsSource).toContain("hiddenKeyLedgerEndpointCondition");
    expect(usageLogsSource).toContain("hiddenStatsLedgerEndpointCondition");
    expect(usageLogsSource).toContain(
      "buildUsageLogEndpointMatchCondition(\n      usageLedger.endpoint,\n      filters.endpoint"
    );
  });
});
