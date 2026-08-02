import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEALTH_TEST_MODELS,
  getDefaultHealthTestModel,
  HEALTH_TEST_GLOBAL_DAILY_BUDGET_DEFAULT,
  healthTestDailyBudgetAmount,
  isHealthTestDue,
  isHealthTestOverDailyBudget,
  MANUAL_HEALTH_TEST_TIMEOUT_MS,
  msUntilNextHealthTestBoundary,
  normalizeHealthTestIntervalSeconds,
  normalizeHealthTestTimeoutSeconds,
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

describe("scheduled health-test runtime settings", () => {
  it("normalizes the live interval and timeout values", () => {
    expect(normalizeHealthTestIntervalSeconds(180)).toBe(180);
    expect(normalizeHealthTestIntervalSeconds(5)).toBe(10);
    expect(normalizeHealthTestIntervalSeconds(4000)).toBe(3600);
    expect(normalizeHealthTestTimeoutSeconds(120)).toBe(120);
    expect(normalizeHealthTestTimeoutSeconds(1)).toBe(5);
    expect(normalizeHealthTestTimeoutSeconds(400)).toBe(300);
  });

  it("uses elapsed time instead of the scheduler poll boundary", () => {
    const last = new Date("2026-07-20T12:00:30.000Z");
    expect(isHealthTestDue(last, new Date("2026-07-20T12:03:29.999Z"), 180_000)).toBe(false);
    expect(isHealthTestDue(last, new Date("2026-07-20T12:03:30.000Z"), 180_000)).toBe(true);
    expect(isHealthTestDue(null, last, 180_000)).toBe(true);
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
