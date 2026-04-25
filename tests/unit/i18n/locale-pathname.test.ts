import { describe, expect, it } from "vitest";
import { normalizePathnameForLocaleNavigation } from "@/i18n/pathname";

describe("normalizePathnameForLocaleNavigation", () => {
  it("keeps an already internal pathname unchanged", () => {
    expect(normalizePathnameForLocaleNavigation("/dashboard/providers")).toBe(
      "/dashboard/providers"
    );
  });

  it("strips a single leading locale", () => {
    expect(normalizePathnameForLocaleNavigation("/en/dashboard")).toBe("/dashboard");
  });

  it("strips repeated leading locales that would otherwise create /en/en", () => {
    expect(normalizePathnameForLocaleNavigation("/en/en/dashboard")).toBe("/dashboard");
  });

  it("preserves query string and hash after stripping locales", () => {
    expect(normalizePathnameForLocaleNavigation("/zh-CN/en/dashboard?tab=logs#row-1")).toBe(
      "/dashboard?tab=logs#row-1"
    );
  });

  it("uses the fallback for locale roots", () => {
    expect(normalizePathnameForLocaleNavigation("/ja")).toBe("/dashboard");
    expect(normalizePathnameForLocaleNavigation("/ru/")).toBe("/dashboard");
  });

  it("rejects non-internal pathnames", () => {
    expect(normalizePathnameForLocaleNavigation("https://example.com/dashboard")).toBe(
      "/dashboard"
    );
    expect(normalizePathnameForLocaleNavigation("//example.com/dashboard")).toBe("/dashboard");
  });
});
