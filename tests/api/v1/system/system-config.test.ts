import type { AuthSession } from "@/lib/auth";
import type { SystemSettings } from "@/types/system-config";
import { beforeEach, describe, expect, test, vi } from "vitest";

const fetchSystemSettingsMock = vi.hoisted(() => vi.fn());
const saveSystemSettingsMock = vi.hoisted(() => vi.fn());
const getServerTimeZoneMock = vi.hoisted(() => vi.fn());
const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const getSystemSettingsRepoMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/system-config", () => ({
  fetchSystemSettings: fetchSystemSettingsMock,
  saveSystemSettings: saveSystemSettingsMock,
  getServerTimeZone: getServerTimeZoneMock,
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: getSystemSettingsRepoMock,
}));

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

const userSession = {
  user: { id: 2, role: "user", isEnabled: true },
  key: { id: 2, userId: 2, key: "user-token", canLoginWebUi: true },
} as AuthSession;

const settings: SystemSettings = {
  id: 1,
  siteTitle: "Claude Code Hub",
  allowGlobalUsageView: true,
  currencyDisplay: "USD",
  billingModelSource: "original",
  codexPriorityBillingSource: "requested",
  timezone: "Asia/Shanghai",
  enableAutoCleanup: false,
  cleanupRetentionDays: 30,
  cleanupSchedule: "0 2 * * *",
  cleanupBatchSize: 10000,
  enableClientVersionCheck: true,
  verboseProviderError: false,
  passThroughUpstreamErrorMessage: true,
  enableHttp2: false,
  enableOpenaiResponsesWebsocket: true,
  enableHighConcurrencyMode: false,
  interceptAnthropicWarmupRequests: false,
  enableThinkingSignatureRectifier: true,
  enableThinkingBudgetRectifier: true,
  enableBillingHeaderRectifier: true,
  enableResponseInputRectifier: true,
  allowNonConversationEndpointProviderFallback: true,
  fakeStreamingWhitelist: [{ model: "gpt-image-2", groupTags: [] }],
  enableCodexSessionIdCompletion: true,
  enableClaudeMetadataUserIdInjection: true,
  enableResponseFixer: true,
  responseFixerConfig: {
    fixTruncatedJson: true,
    fixSseFormat: true,
    fixEncoding: true,
    maxJsonDepth: 200,
    maxFixSize: 1048576,
  },
  quotaDbRefreshIntervalSeconds: 10,
  quotaLeasePercent5h: 0.05,
  quotaLeasePercentDaily: 0.05,
  quotaLeasePercentWeekly: 0.05,
  quotaLeasePercentMonthly: 0.05,
  quotaLeaseCapUsd: null,
  publicStatusWindowHours: 24,
  publicStatusAggregationIntervalMinutes: 5,
  ipExtractionConfig: null,
  ipGeoLookupEnabled: true,
  createdAt: new Date("2026-04-28T00:00:00.000Z"),
  updatedAt: new Date("2026-04-28T00:00:00.000Z"),
};

describe("v1 system config endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    fetchSystemSettingsMock.mockResolvedValue({ ok: true, data: settings });
    getSystemSettingsRepoMock.mockResolvedValue(settings);
    saveSystemSettingsMock.mockResolvedValue({
      ok: true,
      data: { ...settings, siteTitle: "CCH Ops", timezone: "UTC" },
    });
    getServerTimeZoneMock.mockResolvedValue({ ok: true, data: { timeZone: "Asia/Shanghai" } });
  });

  test("reads and updates system settings with ISO date serialization", async () => {
    const got = await callV1Route({
      method: "GET",
      pathname: "/api/v1/system/settings",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(got.response.status).toBe(200);
    expect(got.json).toMatchObject({
      siteTitle: "Claude Code Hub",
      updatedAt: "2026-04-28T00:00:00.000Z",
    });

    const updated = await callV1Route({
      method: "PUT",
      pathname: "/api/v1/system/settings",
      headers: { Authorization: "Bearer admin-token" },
      body: { siteTitle: "CCH Ops", timezone: "UTC" },
    });
    expect(updated.response.status).toBe(200);
    expect(updated.json).toMatchObject({ siteTitle: "CCH Ops", timezone: "UTC" });
    expect(saveSystemSettingsMock).toHaveBeenCalledWith({
      siteTitle: "CCH Ops",
      timezone: "UTC",
    });
  });

  test("returns the server timezone as a read endpoint", async () => {
    const got = await callV1Route({
      method: "GET",
      pathname: "/api/v1/system/timezone",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(got.response.status).toBe(200);
    expect(got.json).toEqual({ timeZone: "Asia/Shanghai" });
  });

  test("returns non-sensitive display settings as a read endpoint", async () => {
    validateAuthTokenMock.mockResolvedValueOnce(userSession);

    const got = await callV1Route({
      method: "GET",
      pathname: "/api/v1/system/display-settings",
      headers: { Authorization: "Bearer user-token" },
    });

    expect(got.response.status).toBe(200);
    expect(got.json).toEqual({
      siteTitle: "Claude Code Hub",
      currencyDisplay: "USD",
      billingModelSource: "original",
    });
    expect(validateAuthTokenMock).toHaveBeenCalledWith("user-token", {
      allowReadOnlyAccess: true,
    });
    expect(fetchSystemSettingsMock).not.toHaveBeenCalled();
    expect(getSystemSettingsRepoMock).toHaveBeenCalled();
  });

  test("rejects unknown fields and invalid timezone values", async () => {
    const unknownField = await callV1Route({
      method: "PUT",
      pathname: "/api/v1/system/settings",
      headers: { Authorization: "Bearer admin-token" },
      body: { siteTitle: "CCH Ops", deprecatedField: true },
    });
    expect(unknownField.response.status).toBe(400);
    expect(unknownField.response.headers.get("content-type")).toContain("application/problem+json");
    expect(saveSystemSettingsMock).not.toHaveBeenCalled();

    const invalidTimezone = await callV1Route({
      method: "PUT",
      pathname: "/api/v1/system/settings",
      headers: { Authorization: "Bearer admin-token" },
      body: { timezone: "Not/AZone" },
    });
    expect(invalidTimezone.response.status).toBe(400);
    expect(invalidTimezone.json).toMatchObject({ errorCode: "request.validation_failed" });
  });

  test("rejects malformed and non-json system settings update bodies", async () => {
    const handlers = await import("@/app/api/v1/resources/system/handlers");
    const malformed = await handlers.updateSystemSettings({
      req: {
        url: "http://localhost/api/v1/system/settings",
        raw: new Request("http://localhost/api/v1/system/settings", {
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

    const unsupported = await handlers.updateSystemSettings({
      req: {
        url: "http://localhost/api/v1/system/settings",
        raw: new Request("http://localhost/api/v1/system/settings", {
          method: "PUT",
          headers: { "Content-Type": "text/plain" },
          body: "timezone=UTC",
        }),
        header: () => undefined,
      },
      get: () => ({ session: adminSession, allowReadOnlyAccess: false }),
    } as never);
    expect(unsupported.status).toBe(415);
  });

  test("maps system action failures to problem+json responses", async () => {
    fetchSystemSettingsMock.mockResolvedValueOnce({
      ok: false,
      error: "权限不足",
      errorCode: "system.forbidden",
    });
    const forbidden = await callV1Route({
      method: "GET",
      pathname: "/api/v1/system/settings",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(forbidden.response.status).toBe(403);
    expect(forbidden.json).toMatchObject({ errorCode: "system.forbidden" });

    saveSystemSettingsMock.mockResolvedValueOnce({
      ok: false,
      error: "保存失败",
      errorCode: "system.save_failed",
      errorParams: { field: "timezone" },
    });
    const saveFailed = await callV1Route({
      method: "PUT",
      pathname: "/api/v1/system/settings",
      headers: { Authorization: "Bearer admin-token" },
      body: { timezone: "UTC" },
    });
    expect(saveFailed.response.status).toBe(400);
    expect(saveFailed.json).toMatchObject({
      errorCode: "system.save_failed",
      errorParams: { field: "timezone" },
    });

    getServerTimeZoneMock.mockResolvedValueOnce({
      ok: false,
      error: "",
    });
    const timezoneFailed = await callV1Route({
      method: "GET",
      pathname: "/api/v1/system/timezone",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(timezoneFailed.response.status).toBe(400);
    expect(timezoneFailed.json).toMatchObject({
      detail: "Bad request",
      errorCode: "system.action_failed",
    });
  });

  test("documents system config REST paths", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/system/settings");
    expect(doc.paths).toHaveProperty("/api/v1/system/display-settings");
    expect(doc.paths).toHaveProperty("/api/v1/system/timezone");
  });
});
