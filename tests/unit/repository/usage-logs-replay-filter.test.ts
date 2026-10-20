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

function buildWhereSql(replayFilter?: "all" | "replay" | "non-replay"): string {
  return buildUsageLogConditions({ replayFilter })
    .map((condition) => sqlToString(condition).toLowerCase())
    .join("\n");
}

function findReplayCondition(replayFilter: "replay" | "non-replay") {
  const condition = buildUsageLogConditions({ replayFilter }).find((candidate) =>
    sqlToString(candidate).toLowerCase().includes("is_replay")
  );
  expect(condition).toBeDefined();
  if (!condition) {
    throw new Error("Expected Replay filter SQL condition to be present");
  }
  return condition.toQuery({
    escapeName: (name: string) => `"${name}"`,
    escapeParam: (num: number, _value: unknown) => `$${num}`,
    escapeString: (value: string) => `'${value}'`,
    casing: new CasingCache(),
    paramStartIndex: { value: 1 },
  });
}

describe("Usage logs Replay filter", () => {
  test("shows all requests by default and for the explicit all filter", () => {
    expect(buildWhereSql()).not.toContain("is_replay");
    expect(buildWhereSql("all")).not.toContain("is_replay");
  });

  test("filters Replay and non-Replay requests explicitly", () => {
    const replayCondition = findReplayCondition("replay");
    const nonReplayCondition = findReplayCondition("non-replay");

    expect(replayCondition.sql.toLowerCase()).toContain('"message_request"."is_replay" = $1');
    expect(replayCondition.params).toEqual([true]);
    expect(nonReplayCondition.sql.toLowerCase()).toContain('"message_request"."is_replay" = $1');
    expect(nonReplayCondition.params).toEqual([false]);
  });
});
