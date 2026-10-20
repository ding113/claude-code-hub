import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("enableMemoryAdmission system setting", () => {
  test("defaults to disabled in the DB-row transformer and keeps an explicit value", async () => {
    const { toSystemSettings } = await import("@/repository/_shared/transformers");

    expect(toSystemSettings(undefined).enableMemoryAdmission).toBe(false);
    expect(toSystemSettings({ id: 1, siteTitle: "CC Hub" }).enableMemoryAdmission).toBe(false);
    expect(toSystemSettings({ id: 1, enableMemoryAdmission: true }).enableMemoryAdmission).toBe(
      true
    );
  });

  test("is accepted by the settings update validation schema", async () => {
    const { UpdateSystemSettingsSchema } = await import("@/lib/validation/schemas");

    expect(UpdateSystemSettingsSchema.parse({ enableMemoryAdmission: true })).toMatchObject({
      enableMemoryAdmission: true,
    });
    expect(UpdateSystemSettingsSchema.parse({}).enableMemoryAdmission).toBeUndefined();
    expect(() => UpdateSystemSettingsSchema.parse({ enableMemoryAdmission: "yes" })).toThrow();
  });

  test("is exposed by the v1 system settings response and update schemas", async () => {
    const { SystemSettingsSchema, SystemSettingsUpdateSchema } = await import(
      "@/lib/api/v1/schemas/system-config"
    );

    expect(Object.keys(SystemSettingsSchema.shape)).toContain("enableMemoryAdmission");
    expect(SystemSettingsUpdateSchema.parse({ enableMemoryAdmission: true })).toEqual({
      enableMemoryAdmission: true,
    });
  });

  test("defaults to disabled in the settings cache fallback", async () => {
    const { DEFAULT_SETTINGS } = await import("@/lib/config/system-settings-cache");

    expect(DEFAULT_SETTINGS.enableMemoryAdmission).toBe(false);
  });

  test("is stored as a non-null column that defaults to false", async () => {
    const { systemSettings } = await import("@/drizzle/schema");

    expect(systemSettings.enableMemoryAdmission.name).toBe("enable_memory_admission");
    expect(systemSettings.enableMemoryAdmission.notNull).toBe(true);
    expect(systemSettings.enableMemoryAdmission.default).toBe(false);
  });
});
