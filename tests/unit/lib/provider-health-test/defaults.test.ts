import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEALTH_TEST_MODELS,
  getDefaultHealthTestModel,
  HEALTH_TEST_GLOBAL_DAILY_BUDGET_DEFAULT,
  healthTestDailyBudgetAmount,
  isHealthTestDueForBucket,
  isHealthTestOverDailyBudget,
  MANUAL_HEALTH_TEST_TIMEOUT_MS,
  msUntilNextHealthTestBoundary,
  SCHEDULED_HEALTH_TEST_TIMEOUT_MS,
} from "@/lib/provider-health-test/defaults";

describe("default health test models", () => {
  it("maps codex/claude/compatible as specified", () => {
    expect(getDefaultHealthTestModel("codex")).toBe("gpt-5.6-terra");
    expect(getDefaultHealthTestModel("claude")).toBe("claude-opus-4-6");
    expect(getDefaultHealthTestModel("claude-auth")).toBe("claude-opus-4-6");
    expect(getDefaultHealthTestModel("openai-compatible")).toBe("grok-4.5");
  });

  it("uses 120s total timeout for manual and scheduled (no 15s first-token kill)", () => {
    expect(MANUAL_HEALTH_TEST_TIMEOUT_MS).toBe(120_000);
    expect(SCHEDULED_HEALTH_TEST_TIMEOUT_MS).toBe(120_000);
  });

  it("covers all provider types", () => {
    for (const type of Object.keys(DEFAULT_HEALTH_TEST_MODELS)) {
      expect(getDefaultHealthTestModel(type as never).length).toBeGreaterThan(0);
    }
  });
});

describe("wall-clock minute alignment", () => {
  it("marks provider due once per wall-clock minute bucket", () => {
    const now = new Date("2026-07-20T12:00:30.000Z");
    expect(isHealthTestDueForBucket(new Date("2026-07-20T12:00:05.000Z"), now)).toBe(false);
    expect(isHealthTestDueForBucket(new Date("2026-07-20T11:59:59.000Z"), now)).toBe(true);
    expect(isHealthTestDueForBucket(null, now)).toBe(true);
  });

  it("computes delay to next minute boundary", () => {
    const now = Date.parse("2026-07-20T12:00:15.000Z");
    expect(msUntilNextHealthTestBoundary(now, 60_000)).toBe(45_000);
    const exact = Date.parse("2026-07-20T12:01:00.000Z");
    expect(msUntilNextHealthTestBoundary(exact, 60_000)).toBe(60_000);
  });
});

describe("daily health-test budget", () => {
  it("defaults global scheduled spend cap to ¥1 with no FX conversion", () => {
    expect(HEALTH_TEST_GLOBAL_DAILY_BUDGET_DEFAULT).toBe(1);
    expect(healthTestDailyBudgetAmount()).toBe(1);
  });

  it("flags over-budget once estimated spend reaches the cap", () => {
    const budget = healthTestDailyBudgetAmount();
    expect(isHealthTestOverDailyBudget(budget - 1e-9)).toBe(false);
    expect(isHealthTestOverDailyBudget(budget)).toBe(true);
    expect(isHealthTestOverDailyBudget(0.5)).toBe(false); // 0.5 < 1
    expect(isHealthTestOverDailyBudget(1)).toBe(true);
    expect(isHealthTestOverDailyBudget(null)).toBe(false);
  });
});
