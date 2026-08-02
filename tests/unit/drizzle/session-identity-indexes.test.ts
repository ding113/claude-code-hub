import type { SQL } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";
import { messageRequest, usageLedger } from "@/drizzle/schema";

function compileSql(value: SQL): string {
  return value
    .toQuery({
      escapeName: (name) => `"${name}"`,
      escapeParam: (num) => `$${num}`,
      escapeString: (text) => `'${text}'`,
      casing: new CasingCache(),
      paramStartIndex: { value: 1 },
    })
    .sql.toLowerCase();
}

describe("Session identity query indexes", () => {
  test.each([
    ["message_request", messageRequest, "idx_message_request_session_identity_created_at", "deleted_at"],
    ["usage_ledger", usageLedger, "idx_usage_ledger_session_identity_created_at", "is_replay"],
  ] as const)("%s indexes COALESCE(session_identity, session_id)", (_label, table, name, predicate) => {
    const index = getTableConfig(table).indexes.find((entry) => entry.config.name === name);
    expect(index).toBeDefined();

    const expression = index?.config.columns[0];
    expect(expression).toBeDefined();
    expect(compileSql(expression as SQL)).toContain("coalesce");
    expect(compileSql(expression as SQL)).toContain("session_identity");
    expect(compileSql(expression as SQL)).toContain("session_id");

    expect(index?.config.where).toBeDefined();
    expect(compileSql(index?.config.where as SQL)).toContain(predicate);
  });

  test("usage_ledger has an unfiltered identity index for grouped source-ID hydration", () => {
    const index = getTableConfig(usageLedger).indexes.find(
      (entry) => entry.config.name === "idx_usage_ledger_session_identity"
    );
    expect(index).toBeDefined();

    const expression = index?.config.columns[0];
    expect(expression).toBeDefined();
    expect(compileSql(expression as SQL)).toContain("coalesce");
    expect(compileSql(expression as SQL)).toContain("session_identity");
    expect(compileSql(expression as SQL)).toContain("session_id");
    expect(index?.config.where).toBeUndefined();
  });
});
