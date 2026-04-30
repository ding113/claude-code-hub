import { z as openApiZ } from "@hono/zod-openapi";
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
    vi.stubEnv("CSRF_SECRET", undefined);

    const { getEnvConfig, isApiKeyAdminAccessEnabled, isLegacyActionsApiEnabled } = await loadEnv();
    const env = getEnvConfig();

    expect(isLegacyActionsApiEnabled()).toBe(true);
    expect(isApiKeyAdminAccessEnabled()).toBe(false);
    expect(env.LEGACY_ACTIONS_DOCS_MODE).toBe("deprecated");
    expect(env.LEGACY_ACTIONS_SUNSET_DATE).toBe("2026-12-31");
    expect(env.CSRF_SECRET).toBeUndefined();
  });

  test("keeps optional env fields unset after OpenAPI zod registration", async () => {
    expect(typeof openApiZ.string().openapi).toBe("function");
    for (const key of [
      "DSN",
      "DB_POOL_MAX",
      "DB_POOL_IDLE_TIMEOUT",
      "DB_POOL_CONNECT_TIMEOUT",
      "MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS",
      "MESSAGE_REQUEST_ASYNC_BATCH_SIZE",
      "MESSAGE_REQUEST_ASYNC_MAX_PENDING",
      "ADMIN_TOKEN",
      "CSRF_SECRET",
    ]) {
      vi.stubEnv(key, undefined);
    }

    const { getEnvConfig } = await loadEnv();
    const env = getEnvConfig();

    expect(env.DSN).toBeUndefined();
    expect(env.DB_POOL_MAX).toBeUndefined();
    expect(env.MESSAGE_REQUEST_ASYNC_BATCH_SIZE).toBeUndefined();
    expect(env.ADMIN_TOKEN).toBeUndefined();
    expect(env.CSRF_SECRET).toBeUndefined();
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

  test("parses dedicated CSRF secret", async () => {
    vi.stubEnv("CSRF_SECRET", "dedicated-csrf-secret");

    const { getEnvConfig } = await loadEnv();

    expect(getEnvConfig().CSRF_SECRET).toBe("dedicated-csrf-secret");
  });

  test("treats blank and placeholder CSRF secrets as unset", async () => {
    vi.stubEnv("CSRF_SECRET", "change-me");

    let env = await loadEnv();
    expect(env.getEnvConfig().CSRF_SECRET).toBeUndefined();

    vi.stubEnv("CSRF_SECRET", "");
    env = await loadEnv();
    expect(env.getEnvConfig().CSRF_SECRET).toBeUndefined();
  });

  test("rejects short CSRF secrets", async () => {
    vi.stubEnv("CSRF_SECRET", "short");

    const { getEnvConfig } = await loadEnv();

    expect(() => getEnvConfig()).toThrow("CSRF_SECRET");
  });
});
