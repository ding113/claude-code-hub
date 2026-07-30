import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("stream gate, affinity, and session snapshot system settings", () => {
  test("default to enforce / enabled in the DB-row transformer", async () => {
    const { toSystemSettings } = await import("@/repository/_shared/transformers");

    expect(toSystemSettings(undefined).streamGateMode).toBe("enforce");
    expect(toSystemSettings(undefined).affinityIgnoreClientSessionId).toBe(true);
    expect(toSystemSettings(undefined).sessionSnapshotStore).toBe("filesystem");
    const persisted = toSystemSettings({ id: 1, siteTitle: "CC Hub" });
    expect(persisted.streamGateMode).toBe("enforce");
    expect(persisted.affinityIgnoreClientSessionId).toBe(true);
    expect(toSystemSettings({ id: 1, streamGateMode: "shadow" }).streamGateMode).toBe("shadow");
    // varchar 脏值回落产品默认
    expect(toSystemSettings({ id: 1, streamGateMode: "bogus" }).streamGateMode).toBe("enforce");
    expect(toSystemSettings({ id: 1, sessionSnapshotStore: "redis" }).sessionSnapshotStore).toBe(
      "redis"
    );
    expect(toSystemSettings({ id: 1, sessionSnapshotStore: "bogus" }).sessionSnapshotStore).toBe(
      "filesystem"
    );
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
      sessionSnapshotStore: "filesystem",
    });
    expect(parsed.streamGateMode).toBe("shadow");
    expect(parsed.affinityIgnoreClientSessionId).toBe(false);
    expect(parsed.sessionSnapshotStore).toBe("filesystem");

    expect(() => UpdateSystemSettingsSchema.parse({ streamGateMode: "bogus" })).toThrow();
    expect(() => UpdateSystemSettingsSchema.parse({ sessionSnapshotStore: "disk" })).toThrow();

    const empty = UpdateSystemSettingsSchema.parse({});
    expect(empty.streamGateMode).toBeUndefined();
    expect(empty.affinityIgnoreClientSessionId).toBeUndefined();
    expect(empty.sessionSnapshotStore).toBeUndefined();
  });

  test("are exposed by the v1 system settings response schema", async () => {
    const { SystemSettingsSchema } = await import("@/lib/api/v1/schemas/system-config");

    expect(Object.keys(SystemSettingsSchema.shape)).toContain("streamGateMode");
    expect(Object.keys(SystemSettingsSchema.shape)).toContain("affinityIgnoreClientSessionId");
    expect(Object.keys(SystemSettingsSchema.shape)).toContain("sessionSnapshotStore");
  });
});
