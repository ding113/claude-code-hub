import { describe, expect, test } from "vitest";

import {
  shouldWarnQuotaDbRefreshIntervalTooHigh,
  shouldWarnQuotaDbRefreshIntervalTooLow,
  shouldWarnQuotaLeaseCapZero,
  shouldWarnQuotaLeasePercentZero,
} from "./quota-lease-warnings";

describe("quota-lease-warnings", () => {
  test("shouldWarnQuotaDbRefreshIntervalTooLow", () => {
    expect(shouldWarnQuotaDbRefreshIntervalTooLow(0)).toBe(false);
    expect(shouldWarnQuotaDbRefreshIntervalTooLow(1)).toBe(true);
    expect(shouldWarnQuotaDbRefreshIntervalTooLow(2)).toBe(true);
    expect(shouldWarnQuotaDbRefreshIntervalTooLow(3)).toBe(false);
    expect(shouldWarnQuotaDbRefreshIntervalTooLow(10)).toBe(false);
  });

  test("shouldWarnQuotaDbRefreshIntervalTooHigh", () => {
    expect(shouldWarnQuotaDbRefreshIntervalTooHigh(59)).toBe(false);
    expect(shouldWarnQuotaDbRefreshIntervalTooHigh(60)).toBe(true);
    expect(shouldWarnQuotaDbRefreshIntervalTooHigh(300)).toBe(true);
  });

  test("shouldWarnQuotaLeasePercentZero", () => {
    expect(shouldWarnQuotaLeasePercentZero(0)).toBe(true);
    expect(shouldWarnQuotaLeasePercentZero(0.01)).toBe(false);
    expect(shouldWarnQuotaLeasePercentZero(1)).toBe(false);
  });

  test("shouldWarnQuotaLeaseCapZero", () => {
    expect(shouldWarnQuotaLeaseCapZero("")).toBe(false);
    expect(shouldWarnQuotaLeaseCapZero("   ")).toBe(false);
    expect(shouldWarnQuotaLeaseCapZero("0")).toBe(true);
    expect(shouldWarnQuotaLeaseCapZero("0.0")).toBe(true);
    expect(shouldWarnQuotaLeaseCapZero("0.01")).toBe(false);
    expect(shouldWarnQuotaLeaseCapZero("abc")).toBe(false);
  });
});
