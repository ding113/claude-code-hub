import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const readCurrentPublicStatusConfigSnapshotMock = vi.hoisted(() => vi.fn());
const readPublicStatusPayloadMock = vi.hoisted(() => vi.fn());
const schedulePublicStatusRebuildMock = vi.hoisted(() => vi.fn());
const savePublicStatusSettingsMock = vi.hoisted(() => vi.fn());
const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const getCachedSystemSettingsMock = vi.hoisted(() => vi.fn());
const lookupIpMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/public-status/config-snapshot", () => ({
  readCurrentPublicStatusConfigSnapshot: readCurrentPublicStatusConfigSnapshotMock,
}));

vi.mock("@/lib/public-status/read-store", () => ({
  readPublicStatusPayload: readPublicStatusPayloadMock,
}));

vi.mock("@/lib/public-status/rebuild-hints", () => ({
  schedulePublicStatusRebuild: schedulePublicStatusRebuildMock,
}));

vi.mock("@/actions/public-status", () => ({
  savePublicStatusSettings: savePublicStatusSettingsMock,
}));

vi.mock("@/lib/config/system-settings-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/system-settings-cache")>();
  return {
    ...actual,
    getCachedSystemSettings: getCachedSystemSettingsMock,
  };
});

vi.mock("@/lib/ip-geo/client", () => ({
  lookupIp: lookupIpMock,
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

describe("v1 public status and ip geo endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    readCurrentPublicStatusConfigSnapshotMock.mockResolvedValue({
      configVersion: "cfg-1",
      siteTitle: "CCH",
      siteDescription: "Status page",
      timeZone: "UTC",
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [{ slug: "default" }],
    });
    readPublicStatusPayloadMock.mockResolvedValue({
      rebuildState: "fresh",
      sourceGeneration: "gen-1",
      generatedAt: "2026-04-28T00:00:00.000Z",
      freshUntil: "2026-04-28T00:05:00.000Z",
      groups: [],
    });
    savePublicStatusSettingsMock.mockResolvedValue({
      ok: true,
      data: {
        updatedGroupCount: 1,
        configVersion: "cfg-1",
        publicStatusProjectionWarningCode: null,
      },
    });
    getCachedSystemSettingsMock.mockResolvedValue({ ipGeoLookupEnabled: true });
    lookupIpMock.mockResolvedValue({
      status: "private",
      data: { ip: "127.0.0.1", kind: "private" },
    });
  });

  test("serves public status without authentication", async () => {
    const got = await callV1Route({
      method: "GET",
      pathname: "/api/v1/public/status?range=1h",
    });

    expect(got.response.status).toBe(200);
    expect(got.response.headers.get("content-type")).toContain("application/json");
    expect(got.json).toMatchObject({ status: "ready", groups: [] });
    expect(readPublicStatusPayloadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        intervalMinutes: 5,
        rangeHours: 24,
        configVersion: "cfg-1",
        hasConfiguredGroups: true,
      })
    );
  });

  test("returns the v1 problem envelope for invalid public status queries", async () => {
    const got = await callV1Route({
      method: "GET",
      pathname: "/api/v1/public/status?status=unknown",
    });

    expect(got.response.status).toBe(400);
    expect(got.response.headers.get("content-type")).toContain("application/problem+json");
    expect(got.json).toMatchObject({
      status: 400,
      errorCode: "public_status.invalid_query",
    });
    expect(readPublicStatusPayloadMock).not.toHaveBeenCalled();
  });

  test("serves rebuilding public status with v1 headers and schedules rebuild hints", async () => {
    readPublicStatusPayloadMock.mockImplementationOnce(
      async ({ triggerRebuildHint }: { triggerRebuildHint: (reason: string) => Promise<void> }) => {
        await triggerRebuildHint("redis-unavailable");
        return {
          rebuildState: "rebuilding",
          sourceGeneration: "",
          generatedAt: null,
          freshUntil: null,
          groups: [],
        };
      }
    );

    const got = await callV1Route({
      method: "GET",
      pathname: "/api/v1/public/status",
    });

    expect(got.response.status).toBe(503);
    expect(got.response.headers.get("Cache-Control")).toBe("no-store");
    expect(got.json).toMatchObject({
      status: "rebuilding",
      rebuildState: { state: "rebuilding", hasSnapshot: false },
    });
    expect(schedulePublicStatusRebuildMock).toHaveBeenCalledWith({
      intervalMinutes: 5,
      rangeHours: 24,
      reason: "redis-unavailable",
    });
  });

  test("serves public status with built-in defaults before settings are configured", async () => {
    readCurrentPublicStatusConfigSnapshotMock.mockResolvedValueOnce(null);

    const got = await callV1Route({
      method: "GET",
      pathname: "/api/v1/public/status?include=meta,defaults,groups",
    });

    expect(got.response.status).toBe(200);
    expect(got.json).toMatchObject({
      defaults: { intervalMinutes: 5, rangeHours: 24 },
      meta: { siteTitle: null, siteDescription: null, timeZone: null },
    });
    expect(readPublicStatusPayloadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        configVersion: undefined,
        hasConfiguredGroups: undefined,
      })
    );
  });

  test("does not swallow unexpected public status failures", async () => {
    readCurrentPublicStatusConfigSnapshotMock.mockRejectedValueOnce(new Error("boom"));

    const got = await callV1Route({
      method: "GET",
      pathname: "/api/v1/public/status",
    });

    expect(got.response.status).toBe(500);
    expect(got.text).toBe("Internal Server Error");
  });

  test("updates public status settings as an admin endpoint", async () => {
    const updated = await callV1Route({
      method: "PUT",
      pathname: "/api/v1/public/status/settings",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        publicStatusWindowHours: 24,
        publicStatusAggregationIntervalMinutes: 5,
        groups: [{ groupName: "default", publicModels: [] }],
      },
    });

    expect(updated.response.status).toBe(200);
    expect(updated.json).toMatchObject({ updatedGroupCount: 1, configVersion: "cfg-1" });
  });

  test("validates and maps public status settings update failures", async () => {
    const invalid = await callV1Route({
      method: "PUT",
      pathname: "/api/v1/public/status/settings",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        publicStatusWindowHours: 0,
        publicStatusAggregationIntervalMinutes: 5,
        groups: [],
      },
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.json).toMatchObject({ errorCode: "request.validation_failed" });
    expect(savePublicStatusSettingsMock).not.toHaveBeenCalled();

    savePublicStatusSettingsMock.mockResolvedValueOnce({
      ok: false,
      error: "not permitted",
      errorCode: "public_status.forbidden",
    });
    const forbidden = await callV1Route({
      method: "PUT",
      pathname: "/api/v1/public/status/settings",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        publicStatusWindowHours: 24,
        publicStatusAggregationIntervalMinutes: 5,
        groups: [],
      },
    });
    expect(forbidden.response.status).toBe(403);
    expect(forbidden.json).toMatchObject({ errorCode: "public_status.forbidden" });

    savePublicStatusSettingsMock.mockResolvedValueOnce({
      ok: false,
      error: "权限不足",
      errorCode: "public_status.action_failed",
    });
    const localizedFailure = await callV1Route({
      method: "PUT",
      pathname: "/api/v1/public/status/settings",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        publicStatusWindowHours: 24,
        publicStatusAggregationIntervalMinutes: 5,
        groups: [],
      },
    });
    expect(localizedFailure.response.status).toBe(400);
    expect(localizedFailure.json).toMatchObject({
      detail: "Bad request",
      errorCode: "public_status.action_failed",
    });

    savePublicStatusSettingsMock.mockResolvedValueOnce({
      ok: false,
      error: "",
    });
    const failed = await callV1Route({
      method: "PUT",
      pathname: "/api/v1/public/status/settings",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        publicStatusWindowHours: 24,
        publicStatusAggregationIntervalMinutes: 5,
        groups: [],
      },
    });
    expect(failed.response.status).toBe(400);
    expect(failed.json).toMatchObject({
      detail: "Bad request",
      errorCode: "public_status.action_failed",
    });
  });

  test("rejects malformed public status settings bodies before actions run", async () => {
    const handlers = await import("@/app/api/v1/resources/public/handlers");
    const malformed = await handlers.updatePublicStatusSettings({
      req: {
        url: "http://localhost/api/v1/public/status/settings",
        raw: new Request("http://localhost/api/v1/public/status/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "{",
        }),
        header: () => undefined,
      },
      get: () => ({ session: adminSession, allowReadOnlyAccess: false }),
    } as never);

    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      errorCode: "request.malformed_json",
    });
    expect(savePublicStatusSettingsMock).not.toHaveBeenCalled();
  });

  test("looks up ip geolocation as a read endpoint", async () => {
    const got = await callV1Route({
      method: "GET",
      pathname: "/api/v1/ip-geo/127.0.0.1?lang=en",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(got.response.status).toBe(200);
    expect(got.json).toEqual({ status: "private", data: { ip: "127.0.0.1", kind: "private" } });
    expect(lookupIpMock).toHaveBeenCalledWith("127.0.0.1", { lang: "en" });
  });

  test("returns problem+json when ip geo is disabled", async () => {
    getCachedSystemSettingsMock.mockResolvedValueOnce({ ipGeoLookupEnabled: false });
    const got = await callV1Route({
      method: "GET",
      pathname: "/api/v1/ip-geo/8.8.8.8",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(got.response.status).toBe(404);
    expect(got.response.headers.get("content-type")).toContain("application/problem+json");
    expect(got.json).toMatchObject({ errorCode: "ip_geo.disabled" });
  });

  test("validates ip geo query parameters before lookup", async () => {
    const got = await callV1Route({
      method: "GET",
      pathname: "/api/v1/ip-geo/8.8.8.8?lang=",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(got.response.status).toBe(400);
    expect(got.json).toMatchObject({ errorCode: "request.validation_failed" });
    expect(lookupIpMock).not.toHaveBeenCalled();
  });

  test("validates ip geo path parameters before lookup", async () => {
    const handlers = await import("@/app/api/v1/resources/public/handlers");
    const got = await handlers.lookupIpGeo({
      req: {
        url: "http://localhost/api/v1/ip-geo/",
        param: () => "",
        query: () => undefined,
      },
    } as never);

    expect(got.status).toBe(400);
    await expect(got.json()).resolves.toMatchObject({
      errorCode: "request.validation_failed",
    });
    expect(lookupIpMock).not.toHaveBeenCalled();
  });

  test("documents public status and ip geo REST paths", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/public/status");
    expect(doc.paths).toHaveProperty("/api/v1/public/status/settings");
    expect(doc.paths).toHaveProperty("/api/v1/ip-geo/{ip}");
  });
});
