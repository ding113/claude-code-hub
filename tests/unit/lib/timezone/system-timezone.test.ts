/**
 * System Timezone Tests
 *
 * TDD tests for the system timezone feature:
 * 1. Timezone field in SystemSettings
 * 2. IANA timezone validation
 * 3. Timezone resolver with fallback chain
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("System Timezone", () => {
  describe("IANA Timezone Validation", () => {
    it("should accept valid IANA timezone strings", async () => {
      const { isValidIANATimezone } = await import("@/lib/utils/timezone");

      expect(isValidIANATimezone("Asia/Shanghai")).toBe(true);
      expect(isValidIANATimezone("America/New_York")).toBe(true);
      expect(isValidIANATimezone("Europe/London")).toBe(true);
      expect(isValidIANATimezone("UTC")).toBe(true);
      expect(isValidIANATimezone("Pacific/Auckland")).toBe(true);
    });

    it("should reject invalid timezone strings", async () => {
      const { isValidIANATimezone } = await import("@/lib/utils/timezone");

      expect(isValidIANATimezone("")).toBe(false);
      expect(isValidIANATimezone("Invalid/Timezone")).toBe(false);
      // Note: Some abbreviations like "CST" may be valid in Intl API depending on environment
      // We test clearly invalid values
      expect(isValidIANATimezone("NotATimezone/AtAll")).toBe(false);
      expect(isValidIANATimezone(null as unknown as string)).toBe(false);
      expect(isValidIANATimezone(undefined as unknown as string)).toBe(false);
    });
  });

  describe("toSystemSettings transformer", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should map timezone field from database", async () => {
      const { toSystemSettings } = await import("@/repository/_shared/transformers");

      const result = toSystemSettings({
        id: 1,
        timezone: "Europe/Paris",
      });

      expect(result.timezone).toBe("Europe/Paris");
    });

    it("should default to null when timezone is not set", async () => {
      const { toSystemSettings } = await import("@/repository/_shared/transformers");

      const result = toSystemSettings({
        id: 1,
      });

      expect(result.timezone).toBeNull();
    });
  });

  describe("UpdateSystemSettingsSchema", () => {
    it("should accept valid IANA timezone", async () => {
      const { UpdateSystemSettingsSchema } = await import("@/lib/validation/schemas");

      const result = UpdateSystemSettingsSchema.safeParse({
        timezone: "Asia/Tokyo",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timezone).toBe("Asia/Tokyo");
      }
    });

    it("should reject invalid timezone", async () => {
      const { UpdateSystemSettingsSchema } = await import("@/lib/validation/schemas");

      const result = UpdateSystemSettingsSchema.safeParse({
        timezone: "Invalid/Zone",
      });

      expect(result.success).toBe(false);
    });

    it("should accept undefined timezone (no update)", async () => {
      const { UpdateSystemSettingsSchema } = await import("@/lib/validation/schemas");

      const result = UpdateSystemSettingsSchema.safeParse({
        siteTitle: "Test Site",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timezone).toBeUndefined();
      }
    });

    it("should accept null timezone (clear setting)", async () => {
      const { UpdateSystemSettingsSchema } = await import("@/lib/validation/schemas");

      const result = UpdateSystemSettingsSchema.safeParse({
        timezone: null,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timezone).toBeNull();
      }
    });
  });
});
