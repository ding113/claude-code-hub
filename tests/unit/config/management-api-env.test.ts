import { afterEach, describe, expect, test, vi } from "vitest";

async function loadEnv() {
  vi.resetModules();
  return import("@/lib/config/env.schema");
}

describe("management API env flags", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("uses safe defaults", async () => {
    vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", undefined);
    vi.stubEnv("ENABLE_API_KEY_ADMIN_ACCESS", undefined);
    vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", undefined);
    vi.stubEnv("LEGACY_ACTIONS_SUNSET_DATE", undefined);

    const { getEnvConfig, isApiKeyAdminAccessEnabled, isLegacyActionsApiEnabled } = await loadEnv();
    const env = getEnvConfig();

    expect(isLegacyActionsApiEnabled()).toBe(true);
    expect(isApiKeyAdminAccessEnabled()).toBe(false);
    expect(env.LEGACY_ACTIONS_DOCS_MODE).toBe("deprecated");
    expect(env.LEGACY_ACTIONS_SUNSET_DATE).toBe("2026-12-31");
  });

  test("parses explicit boolean strings without z.coerce.boolean pitfalls", async () => {
    vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "false");
    vi.stubEnv("ENABLE_API_KEY_ADMIN_ACCESS", "true");

    const { isApiKeyAdminAccessEnabled, isLegacyActionsApiEnabled } = await loadEnv();

    expect(isLegacyActionsApiEnabled()).toBe(false);
    expect(isApiKeyAdminAccessEnabled()).toBe(true);
  });

  test("parses zero as false", async () => {
    vi.stubEnv("ENABLE_API_KEY_ADMIN_ACCESS", "0");

    const { isApiKeyAdminAccessEnabled } = await loadEnv();

    expect(isApiKeyAdminAccessEnabled()).toBe(false);
  });

  test("parses legacy docs mode and custom sunset date", async () => {
    vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "hidden");
    vi.stubEnv("LEGACY_ACTIONS_SUNSET_DATE", "2027-03-31");

    const { getEnvConfig } = await loadEnv();

    expect(getEnvConfig()).toMatchObject({
      LEGACY_ACTIONS_DOCS_MODE: "hidden",
      LEGACY_ACTIONS_SUNSET_DATE: "2027-03-31",
    });
  });
});
