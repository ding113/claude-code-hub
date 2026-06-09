/**
 * System Settings Quota Lease Validation Tests
 *
 * TDD: RED phase - tests for quota lease settings fields
 */

import { describe, expect, test } from "vitest";
import { UpdateSystemSettingsSchema } from "@/lib/validation/schemas";

describe("UpdateSystemSettingsSchema: quota lease settings", () => {
  describe("quotaDbRefreshIntervalSeconds", () => {
    test("accepts valid refresh interval (10)", () => {
      const parsed = UpdateSystemSettingsSchema.parse({
        quotaDbRefreshIntervalSeconds: 10,
      });
      expect(parsed.quotaDbRefreshIntervalSeconds).toBe(10);
    });

    // bugfix #05: minimum was raised from 1s to 5s so the display cache TTL
    // never collapses into dashboard polling cadence.
    test("accepts minimum value (5)", () => {
      const parsed = UpdateSystemSettingsSchema.parse({
        quotaDbRefreshIntervalSeconds: 5,
      });
      expect(parsed.quotaDbRefreshIntervalSeconds).toBe(5);
    });

    test("accepts maximum value (300)", () => {
      const parsed = UpdateSystemSettingsSchema.parse({
        quotaDbRefreshIntervalSeconds: 300,
      });
      expect(parsed.quotaDbRefreshIntervalSeconds).toBe(300);
    });

    test("rejects value below new minimum (4)", () => {
      expect(() =>
        UpdateSystemSettingsSchema.parse({
          quotaDbRefreshIntervalSeconds: 4,
        })
      ).toThrow();
    });

    test("rejects zero", () => {
      expect(() =>
        UpdateSystemSettingsSchema.parse({
          quotaDbRefreshIntervalSeconds: 0,
        })
      ).toThrow();
    });

    test("rejects value above maximum (301)", () => {
      expect(() =>
        UpdateSystemSettingsSchema.parse({
          quotaDbRefreshIntervalSeconds: 301,
        })
      ).toThrow();
    });

    test("rejects non-integer value", () => {
      expect(() =>
        UpdateSystemSettingsSchema.parse({
          quotaDbRefreshIntervalSeconds: 10.5,
        })
      ).toThrow();
    });
  });

  describe("quotaLeasePercent5h", () => {
    test("accepts valid percent (0.05)", () => {
      const parsed = UpdateSystemSettingsSchema.parse({
        quotaLeasePercent5h: 0.05,
      });
      expect(parsed.quotaLeasePercent5h).toBe(0.05);
    });

    test("accepts minimum value (0)", () => {
      const parsed = UpdateSystemSettingsSchema.parse({
        quotaLeasePercent5h: 0,
      });
      expect(parsed.quotaLeasePercent5h).toBe(0);
    });

    test("accepts maximum value (1)", () => {
      const parsed = UpdateSystemSettingsSchema.parse({
        quotaLeasePercent5h: 1,
      });
      expect(parsed.quotaLeasePercent5h).toBe(1);
    });

    test("rejects value below minimum (-0.01)", () => {
      expect(() =>
        UpdateSystemSettingsSchema.parse({
          quotaLeasePercent5h: -0.01,
        })
      ).toThrow();
    });

    test("rejects value above maximum (1.01)", () => {
      expect(() =>
        UpdateSystemSettingsSchema.parse({
          quotaLeasePercent5h: 1.01,
        })
      ).toThrow();
    });
  });

  describe("quotaLeasePercentDaily", () => {
    test("accepts valid percent (0.05)", () => {
      const parsed = UpdateSystemSettingsSchema.parse({
        quotaLeasePercentDaily: 0.05,
      });
      expect(parsed.quotaLeasePercentDaily).toBe(0.05);
    });

    test("accepts edge values (0 and 1)", () => {
      expect(
        UpdateSystemSettingsSchema.parse({ quotaLeasePercentDaily: 0 }).quotaLeasePercentDaily
      ).toBe(0);
      expect(
        UpdateSystemSettingsSchema.parse({ quotaLeasePercentDaily: 1 }).quotaLeasePercentDaily
      ).toBe(1);
    });

    test("rejects out of range values", () => {
      expect(() => UpdateSystemSettingsSchema.parse({ quotaLeasePercentDaily: -0.01 })).toThrow();
      expect(() => UpdateSystemSettingsSchema.parse({ quotaLeasePercentDaily: 1.01 })).toThrow();
    });
  });

  describe("quotaLeasePercentWeekly", () => {
    test("accepts valid percent (0.02)", () => {
      const parsed = UpdateSystemSettingsSchema.parse({
        quotaLeasePercentWeekly: 0.02,
      });
      expect(parsed.quotaLeasePercentWeekly).toBe(0.02);
    });

    test("accepts edge values (0 and 1)", () => {
      expect(
        UpdateSystemSettingsSchema.parse({ quotaLeasePercentWeekly: 0 }).quotaLeasePercentWeekly
      ).toBe(0);
      expect(
        UpdateSystemSettingsSchema.parse({ quotaLeasePercentWeekly: 1 }).quotaLeasePercentWeekly
      ).toBe(1);
    });

    test("rejects out of range values", () => {
      expect(() => UpdateSystemSettingsSchema.parse({ quotaLeasePercentWeekly: -0.01 })).toThrow();
      expect(() => UpdateSystemSettingsSchema.parse({ quotaLeasePercentWeekly: 1.01 })).toThrow();
    });
  });

  describe("quotaLeasePercentMonthly", () => {
    test("accepts valid percent (0.01)", () => {
      const parsed = UpdateSystemSettingsSchema.parse({
        quotaLeasePercentMonthly: 0.01,
      });
      expect(parsed.quotaLeasePercentMonthly).toBe(0.01);
    });

    test("accepts edge values (0 and 1)", () => {
      expect(
        UpdateSystemSettingsSchema.parse({ quotaLeasePercentMonthly: 0 }).quotaLeasePercentMonthly
      ).toBe(0);
      expect(
        UpdateSystemSettingsSchema.parse({ quotaLeasePercentMonthly: 1 }).quotaLeasePercentMonthly
      ).toBe(1);
    });

    test("rejects out of range values", () => {
      expect(() => UpdateSystemSettingsSchema.parse({ quotaLeasePercentMonthly: -0.01 })).toThrow();
      expect(() => UpdateSystemSettingsSchema.parse({ quotaLeasePercentMonthly: 1.01 })).toThrow();
    });
  });

  describe("quotaLeaseCapUsd", () => {
    test("accepts valid cap (3.0)", () => {
      const parsed = UpdateSystemSettingsSchema.parse({
        quotaLeaseCapUsd: 3.0,
      });
      expect(parsed.quotaLeaseCapUsd).toBe(3.0);
    });

    test("accepts null (no cap)", () => {
      const parsed = UpdateSystemSettingsSchema.parse({
        quotaLeaseCapUsd: null,
      });
      expect(parsed.quotaLeaseCapUsd).toBeNull();
    });

    test("accepts zero (disabled)", () => {
      const parsed = UpdateSystemSettingsSchema.parse({
        quotaLeaseCapUsd: 0,
      });
      expect(parsed.quotaLeaseCapUsd).toBe(0);
    });

    test("accepts high value (1000)", () => {
      const parsed = UpdateSystemSettingsSchema.parse({
        quotaLeaseCapUsd: 1000,
      });
      expect(parsed.quotaLeaseCapUsd).toBe(1000);
    });

    test("rejects negative value", () => {
      expect(() =>
        UpdateSystemSettingsSchema.parse({
          quotaLeaseCapUsd: -1,
        })
      ).toThrow();
    });
  });

  describe("model-bucket lease settings (OPT-B)", () => {
    test("accepts valid model lease percents", () => {
      const parsed = UpdateSystemSettingsSchema.parse({
        quotaModelLeasePercent5h: 0.1,
        quotaModelLeasePercentDaily: 0.08,
        quotaModelLeasePercentWeekly: 0.06,
        quotaModelLeasePercentMonthly: 0.04,
        quotaModelLeaseMinSliceUsd: 0.5,
      });
      expect(parsed.quotaModelLeasePercent5h).toBe(0.1);
      expect(parsed.quotaModelLeasePercentDaily).toBe(0.08);
      expect(parsed.quotaModelLeasePercentWeekly).toBe(0.06);
      expect(parsed.quotaModelLeasePercentMonthly).toBe(0.04);
      expect(parsed.quotaModelLeaseMinSliceUsd).toBe(0.5);
    });

    test("accepts null to clear the override (fall back to global)", () => {
      const parsed = UpdateSystemSettingsSchema.parse({
        quotaModelLeasePercent5h: null,
        quotaModelLeasePercentDaily: null,
        quotaModelLeasePercentWeekly: null,
        quotaModelLeasePercentMonthly: null,
        quotaModelLeaseMinSliceUsd: null,
      });
      expect(parsed.quotaModelLeasePercent5h).toBeNull();
      expect(parsed.quotaModelLeasePercentDaily).toBeNull();
      expect(parsed.quotaModelLeasePercentWeekly).toBeNull();
      expect(parsed.quotaModelLeasePercentMonthly).toBeNull();
      expect(parsed.quotaModelLeaseMinSliceUsd).toBeNull();
    });

    test("accepts edge percents (0 and 1)", () => {
      expect(
        UpdateSystemSettingsSchema.parse({ quotaModelLeasePercent5h: 0 }).quotaModelLeasePercent5h
      ).toBe(0);
      expect(
        UpdateSystemSettingsSchema.parse({ quotaModelLeasePercentDaily: 1 })
          .quotaModelLeasePercentDaily
      ).toBe(1);
    });

    test("rejects out-of-range percents", () => {
      expect(() => UpdateSystemSettingsSchema.parse({ quotaModelLeasePercent5h: -0.01 })).toThrow();
      expect(() =>
        UpdateSystemSettingsSchema.parse({ quotaModelLeasePercentDaily: 1.01 })
      ).toThrow();
    });

    test("rejects negative min slice", () => {
      expect(() => UpdateSystemSettingsSchema.parse({ quotaModelLeaseMinSliceUsd: -1 })).toThrow();
    });
  });

  describe("combined fields", () => {
    test("accepts all quota lease fields together", () => {
      const parsed = UpdateSystemSettingsSchema.parse({
        quotaDbRefreshIntervalSeconds: 60,
        quotaLeasePercent5h: 0.1,
        quotaLeasePercentDaily: 0.05,
        quotaLeasePercentWeekly: 0.02,
        quotaLeasePercentMonthly: 0.01,
        quotaLeaseCapUsd: 3.0,
      });

      expect(parsed.quotaDbRefreshIntervalSeconds).toBe(60);
      expect(parsed.quotaLeasePercent5h).toBe(0.1);
      expect(parsed.quotaLeasePercentDaily).toBe(0.05);
      expect(parsed.quotaLeasePercentWeekly).toBe(0.02);
      expect(parsed.quotaLeasePercentMonthly).toBe(0.01);
      expect(parsed.quotaLeaseCapUsd).toBe(3.0);
    });

    test("all fields are optional", () => {
      const parsed = UpdateSystemSettingsSchema.parse({});
      expect(parsed.quotaDbRefreshIntervalSeconds).toBeUndefined();
      expect(parsed.quotaLeasePercent5h).toBeUndefined();
      expect(parsed.quotaLeasePercentDaily).toBeUndefined();
      expect(parsed.quotaLeasePercentWeekly).toBeUndefined();
      expect(parsed.quotaLeasePercentMonthly).toBeUndefined();
      expect(parsed.quotaLeaseCapUsd).toBeUndefined();
      expect(parsed.quotaModelLeasePercent5h).toBeUndefined();
      expect(parsed.quotaModelLeaseMinSliceUsd).toBeUndefined();
    });
  });
});
