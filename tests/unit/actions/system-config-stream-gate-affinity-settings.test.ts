import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("streamGateMode / affinityIgnoreClientSessionId system settings", () => {
  test("default to enforce / enabled in the DB-row transformer", async () => {
    const { toSystemSettings } = await import("@/repository/_shared/transformers");

    expect(toSystemSettings(undefined).streamGateMode).toBe("enforce");
    expect(toSystemSettings(undefined).affinityIgnoreClientSessionId).toBe(true);
    expect(toSystemSettings({ id: 1, siteTitle: "Claude Code Hub" }).streamGateMode).toBe(
      "enforce"
    );
    expect(
      toSystemSettings({ id: 1, siteTitle: "Claude Code Hub" }).affinityIgnoreClientSessionId
    ).toBe(true);
    expect(toSystemSettings({ id: 1, streamGateMode: "shadow" }).streamGateMode).toBe("shadow");
    // varchar 脏值回落产品默认
    expect(toSystemSettings({ id: 1, streamGateMode: "bogus" }).streamGateMode).toBe("enforce");
    expect(
      toSystemSettings({ id: 1, affinityIgnoreClientSessionId: false })
        .affinityIgnoreClientSessionId
    ).toBe(false);
  });

  test("are accepted by the settings update validation schema", async () => {
    const { UpdateSystemSettingsSchema } = await import("@/lib/validation/schemas");

    const parsed = UpdateSystemSettingsSchema.parse({
      streamGateMode: "shadow",
      affinityIgnoreClientSessionId: false,
    });
    expect(parsed.streamGateMode).toBe("shadow");
    expect(parsed.affinityIgnoreClientSessionId).toBe(false);

    expect(() => UpdateSystemSettingsSchema.parse({ streamGateMode: "bogus" })).toThrow();

    const empty = UpdateSystemSettingsSchema.parse({});
    expect(empty.streamGateMode).toBeUndefined();
    expect(empty.affinityIgnoreClientSessionId).toBeUndefined();
  });

  test("are exposed by the v1 system settings response schema", async () => {
    const { SystemSettingsSchema } = await import("@/lib/api/v1/schemas/system-config");

    expect(Object.keys(SystemSettingsSchema.shape)).toContain("streamGateMode");
    expect(Object.keys(SystemSettingsSchema.shape)).toContain("affinityIgnoreClientSessionId");
  });
});
