import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("enableGeminiFunctionIdRectifier system setting", () => {
  test("defaults to enabled in the DB-row transformer", async () => {
    const { toSystemSettings } = await import("@/repository/_shared/transformers");

    expect(toSystemSettings(undefined).enableGeminiFunctionIdRectifier).toBe(true);
    expect(
      toSystemSettings({ id: 1, siteTitle: "Claude Code Hub" }).enableGeminiFunctionIdRectifier
    ).toBe(true);
    expect(
      toSystemSettings({ id: 1, enableGeminiFunctionIdRectifier: false })
        .enableGeminiFunctionIdRectifier
    ).toBe(false);
  });

  test("is accepted by the settings update validation schema", async () => {
    const { UpdateSystemSettingsSchema } = await import("@/lib/validation/schemas");

    const parsed = UpdateSystemSettingsSchema.parse({
      enableGeminiFunctionIdRectifier: false,
    });
    expect(parsed.enableGeminiFunctionIdRectifier).toBe(false);

    const empty = UpdateSystemSettingsSchema.parse({});
    expect(empty.enableGeminiFunctionIdRectifier).toBeUndefined();
  });

  test("is exposed by the v1 system settings response schema", async () => {
    const { SystemSettingsSchema } = await import("@/lib/api/v1/schemas/system-config");

    expect(Object.keys(SystemSettingsSchema.shape)).toContain("enableGeminiFunctionIdRectifier");
  });
});
