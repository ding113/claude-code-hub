import type { SQL } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";
import { describe, expect, test } from "vitest";

import { buildUsageLogConditions } from "@/repository/_shared/usage-log-filters";

function sqlToString(sqlObj: SQL): string {
  return sqlObj.toQuery({
    escapeName: (name: string) => `"${name}"`,
    escapeParam: (num: number, _value: unknown) => `$${num}`,
    escapeString: (value: string) => `'${value}'`,
    casing: new CasingCache(),
    paramStartIndex: { value: 1 },
  }).sql;
}

describe("Usage logs actual response model mismatch filter", () => {
  test("compares requested billing model with actual response model, not redirected model", () => {
    const conditions = buildUsageLogConditions({ actualResponseModelMismatch: true });
    const mismatchCondition = conditions.find((condition) =>
      sqlToString(condition).toLowerCase().includes("actual_response_model")
    );

    expect(mismatchCondition).toBeDefined();
    if (!mismatchCondition) {
      throw new Error("Expected actual response model mismatch SQL condition to be present");
    }

    const whereSql = sqlToString(mismatchCondition).toLowerCase();
    expect(whereSql).toContain("coalesce");
    expect(whereSql).toContain('"message_request"."model"');
    expect(whereSql).toContain('"message_request"."original_model"');
    expect(whereSql).toContain('"message_request"."actual_response_model"');
    expect(whereSql).toContain("<>");
    expect(whereSql).not.toContain(
      '"message_request"."original_model" <> "message_request"."model"'
    );
    expect(whereSql).not.toContain(
      '"message_request"."model" <> "message_request"."original_model"'
    );
  });

  test("does not add mismatch condition when the optional flag is absent or false", () => {
    const baseSql = buildUsageLogConditions({})
      .map((condition) => sqlToString(condition).toLowerCase())
      .join("\n");
    const disabledSql = buildUsageLogConditions({ actualResponseModelMismatch: false })
      .map((condition) => sqlToString(condition).toLowerCase())
      .join("\n");

    expect(baseSql).not.toContain("actual_response_model");
    expect(disabledSql).toBe(baseSql);
  });
});
