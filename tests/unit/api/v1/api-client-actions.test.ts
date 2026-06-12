import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DASHBOARD_COMPAT_HEADER } from "@/lib/api/v1/_shared/constants";
import { ApiError } from "@/lib/api-client/v1/errors";

const getMock = vi.hoisted(() => vi.fn());
const patchMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client/v1/client", () => ({
  apiClient: {
    get: getMock,
    patch: patchMock,
    post: postMock,
    delete: deleteMock,
  },
}));

const providers = await vi.importActual<typeof import("@/lib/api-client/v1/actions/providers")>(
  "@/lib/api-client/v1/actions/providers"
);
const myUsage = await vi.importActual<typeof import("@/lib/api-client/v1/actions/my-usage")>(
  "@/lib/api-client/v1/actions/my-usage"
);
const systemConfig = await vi.importActual<
  typeof import("@/lib/api-client/v1/actions/system-config")
>("@/lib/api-client/v1/actions/system-config");
const users = await vi.importActual<typeof import("@/lib/api-client/v1/actions/users")>(
  "@/lib/api-client/v1/actions/users"
);
const providerEndpoints = await vi.importActual<
  typeof import("@/lib/api-client/v1/actions/provider-endpoints")
>("@/lib/api-client/v1/actions/provider-endpoints");
const usageLogs = await vi.importActual<typeof import("@/lib/api-client/v1/actions/usage-logs")>(
  "@/lib/api-client/v1/actions/usage-logs"
);
const keys = await vi.importActual<typeof import("@/lib/api-client/v1/actions/keys")>(
  "@/lib/api-client/v1/actions/keys"
);

describe("v1 action compatibility client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Always restore globals, even if a stubbed-fetch test throws mid-assertion.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("preserves provider edit undo metadata from response headers", async () => {
    patchMock.mockImplementation(
      async (
        _path: string,
        _body: unknown,
        options?: { onResponse?: (response: Response) => void }
      ) => {
        options?.onResponse?.(
          new Response("{}", {
            headers: {
              "X-CCH-Operation-Id": "op-123",
              "X-CCH-Undo-Token": "undo-123",
            },
          })
        );
        return { id: 7 };
      }
    );

    const result = await providers.editProvider(7, { name: "primary" });

    expect(patchMock).toHaveBeenCalledWith(
      "/api/v1/providers/7",
      { name: "primary" },
      expect.any(Object)
    );
    expect(result).toEqual({
      ok: true,
      data: {
        operationId: "op-123",
        undoToken: "undo-123",
      },
    });
  });

  test("marks provider reads as dashboard compatibility requests", async () => {
    getMock.mockResolvedValue({
      items: [{ id: 2, name: "Legacy hidden", providerType: "claude-auth" }],
    });

    await expect(providers.getProviders()).resolves.toEqual([
      { id: 2, name: "Legacy hidden", providerType: "claude-auth" },
    ]);

    expect(getMock).toHaveBeenCalledWith("/api/v1/providers", {
      headers: { [DASHBOARD_COMPAT_HEADER]: "1" },
    });
  });

  test("maps my-usage IP lookup to the v1 self-scoped endpoint", async () => {
    getMock.mockResolvedValue({ status: "success", ip: "203.0.113.1" });

    const result = await myUsage.getMyIpGeoDetails({ ip: "203.0.113.1", lang: "zh-CN" });

    expect(getMock).toHaveBeenCalledWith("/api/v1/me/ip-geo/203.0.113.1?lang=zh-CN");
    expect(result).toEqual({
      ok: true,
      data: { status: "success", ip: "203.0.113.1" },
    });
  });

  test("maps system settings reads to the v1 system endpoint", async () => {
    getMock.mockResolvedValue({ currencyDisplay: "USD" });

    await expect(systemConfig.getSystemSettings()).resolves.toEqual({ currencyDisplay: "USD" });

    expect(getMock).toHaveBeenCalledWith("/api/v1/system/settings");
  });

  test("falls back to read-only display settings for non-admin system settings readers", async () => {
    getMock
      .mockRejectedValueOnce(
        new ApiError({
          status: 403,
          errorCode: "auth.forbidden",
          detail: "Admin access is required.",
        })
      )
      .mockResolvedValueOnce({
        siteTitle: "Claude Code Hub",
        currencyDisplay: "USD",
        billingModelSource: "original",
      });

    await expect(systemConfig.getSystemSettings()).resolves.toEqual({
      siteTitle: "Claude Code Hub",
      currencyDisplay: "USD",
      billingModelSource: "original",
    });

    expect(getMock).toHaveBeenNthCalledWith(1, "/api/v1/system/settings");
    expect(getMock).toHaveBeenNthCalledWith(2, "/api/v1/system/display-settings");
  });

  test("falls back to the v1 current-user endpoint for non-admin user lists", async () => {
    getMock
      .mockRejectedValueOnce(
        new ApiError({
          status: 403,
          errorCode: "auth.forbidden",
          detail: "Admin access is required.",
        })
      )
      .mockResolvedValueOnce({
        items: [{ id: 9, name: "self", keys: [{ id: 90, name: "default" }] }],
        pageInfo: { nextCursor: null, hasMore: false },
      });

    const result = await users.getUsers();

    expect(result).toHaveLength(1);
    expect(result).toMatchObject([{ id: 9, name: "self", keys: [{ id: 90, name: "default" }] }]);

    expect(getMock).toHaveBeenNthCalledWith(1, "/api/v1/users");
    expect(getMock).toHaveBeenNthCalledWith(2, "/api/v1/users:self");
  });

  test("revives v1 user list date strings for legacy dashboard components", async () => {
    getMock.mockResolvedValue({
      items: [
        {
          id: 7,
          name: "dated user",
          keys: [
            {
              id: 11,
              createdAt: "2026-04-30T07:41:10.000Z",
              lastUsedAt: "2026-04-30T08:00:00.000Z",
            },
          ],
          costResetAt: "2026-04-30T00:00:00.000Z",
          expiresAt: "2026-05-07T07:41:10.000Z",
        },
      ],
      pageInfo: { nextCursor: null, hasMore: false, limit: 50 },
    });

    const result = await users.getUsersBatchCore({ limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [user] = result.data.users;
    expect(user.expiresAt).toBeInstanceOf(Date);
    expect(user.expiresAt?.toISOString()).toBe("2026-05-07T07:41:10.000Z");
    expect(user.costResetAt).toBeInstanceOf(Date);
    expect(user.keys[0]?.createdAt).toBeInstanceOf(Date);
    expect(user.keys[0]?.lastUsedAt).toBeInstanceOf(Date);
  });

  test("revives numeric epoch timestamps instead of treating zero as empty", async () => {
    getMock.mockResolvedValue({
      items: [
        {
          id: 8,
          name: "epoch user",
          keys: [{ id: 12, createdAt: 0, lastUsedAt: 0 }],
          costResetAt: 0,
          expiresAt: 0,
        },
      ],
      pageInfo: { nextCursor: null, hasMore: false, limit: 50 },
    });

    const result = await users.getUsersBatchCore({ limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [user] = result.data.users;
    expect(user.expiresAt?.toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect(user.costResetAt?.toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect(user.keys[0]?.createdAt.toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect(user.keys[0]?.lastUsedAt?.toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });

  test("marks dashboard user search as a compatibility request", async () => {
    getMock.mockResolvedValue({ items: [{ id: 1, name: "Admin" }] });

    const result = await users.searchUsers(undefined, 5000);

    expect(getMock).toHaveBeenCalledWith("/api/v1/users:search?limit=5000", {
      headers: { [DASHBOARD_COMPAT_HEADER]: "1" },
    });
    expect(result).toEqual({ ok: true, data: [{ id: 1, name: "Admin" }] });
  });

  test("maps provider endpoint probe logs to the v1 resource endpoint", async () => {
    getMock.mockResolvedValue({ logs: [] });

    const result = await providerEndpoints.getProviderEndpointProbeLogs({
      endpointId: 12,
      limit: 50,
    });

    expect(getMock).toHaveBeenCalledWith("/api/v1/provider-endpoints/12/probe-logs?limit=50", {
      headers: { [DASHBOARD_COMPAT_HEADER]: "1" },
    });
    expect(result).toEqual({ ok: true, data: { logs: [] } });
  });

  test("passes hidden provider endpoint filters through the dashboard compatibility path", async () => {
    getMock.mockResolvedValue({
      items: [{ id: 1, providerType: "claude-auth" }],
    });

    await expect(
      providerEndpoints.getProviderEndpoints({
        vendorId: 2,
        providerType: "claude-auth",
        dashboard: true,
      })
    ).resolves.toEqual([{ id: 1, providerType: "claude-auth" }]);

    expect(getMock).toHaveBeenCalledWith(
      "/api/v1/provider-vendors/2/endpoints?providerType=claude-auth&dashboard=true",
      { headers: { [DASHBOARD_COMPAT_HEADER]: "1" } }
    );
  });

  test("requests hidden provider endpoint stats from the server batch endpoint", async () => {
    postMock.mockResolvedValue([
      {
        vendorId: 2,
        total: 3,
        enabled: 2,
        healthy: 1,
        unhealthy: 1,
        unknown: 0,
      },
    ]);

    const result = await providerEndpoints.batchGetVendorTypeEndpointStats({
      vendorIds: [2, 2],
      providerType: "claude-auth",
    });

    expect(getMock).not.toHaveBeenCalled();
    expect(postMock).toHaveBeenCalledWith(
      "/api/v1/provider-vendors/endpoint-stats:batch",
      { vendorIds: [2, 2], providerType: "claude-auth" },
      { headers: { [DASHBOARD_COMPAT_HEADER]: "1" } }
    );
    expect(result).toEqual({
      ok: true,
      data: [
        {
          vendorId: 2,
          total: 3,
          enabled: 2,
          healthy: 1,
          unhealthy: 1,
          unknown: 0,
        },
      ],
    });
  });

  test("decodes opaque usage-log cursors before returning the legacy page shape", async () => {
    const cursor = { createdAt: "2026-04-28T00:00:00.000Z", id: 42 };
    const token = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
    getMock
      .mockResolvedValueOnce({
        items: [],
        pageInfo: { nextCursor: token, hasMore: true, limit: 15 },
      })
      .mockResolvedValueOnce({
        items: [],
        pageInfo: { nextCursor: null, hasMore: false, limit: 15 },
      });

    const firstPage = await usageLogs.getUsageLogsBatch({ limit: 15 });
    expect(firstPage).toEqual({
      ok: true,
      data: { logs: [], nextCursor: cursor, hasMore: true },
    });

    await usageLogs.getUsageLogsBatch({
      cursor: firstPage.ok ? firstPage.data.nextCursor : null,
      limit: 15,
    });

    expect(getMock).toHaveBeenNthCalledWith(1, "/api/v1/usage-logs?limit=15");
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/usage-logs?cursorCreatedAt=2026-04-28T00%3A00%3A00.000Z&cursorId=42&limit=15"
    );
  });

  test("serializes opaque usage-log cursor strings as server cursor components", async () => {
    const cursor = { createdAt: "2026-04-28T00:00:00.000Z", id: 42 };
    const token = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
    getMock.mockResolvedValue({
      items: [],
      pageInfo: { nextCursor: null, hasMore: false, limit: 15 },
    });

    await usageLogs.getUsageLogsBatch({ cursor: token, limit: 15 });

    expect(getMock).toHaveBeenCalledWith(
      "/api/v1/usage-logs?cursorCreatedAt=2026-04-28T00%3A00%3A00.000Z&cursorId=42&limit=15"
    );
  });

  test("returns the raw provider health map without ActionResult wrapping", async () => {
    // 仪表盘的 useQuery 直接消费返回值；如果再被包成 `{ ok, data }`，
    // 熔断状态指示器和重置按钮会因为 `healthStatus[id]?.circuitState` 永远 undefined 而不显示。
    const healthMap = {
      1: {
        circuitState: "open" as const,
        failureCount: 7,
        lastFailureTime: 1_700_000_000_000,
        circuitOpenUntil: 1_700_000_300_000,
        recoveryMinutes: 5,
      },
      2: {
        circuitState: "closed" as const,
        failureCount: 0,
        lastFailureTime: null,
        circuitOpenUntil: null,
        recoveryMinutes: null,
      },
    };
    getMock.mockResolvedValue(healthMap);

    const result = await providers.getProvidersHealthStatus();

    expect(getMock).toHaveBeenCalledWith("/api/v1/providers/health", {
      headers: { [DASHBOARD_COMPAT_HEADER]: "1" },
    });
    expect(result).toEqual(healthMap);
    // Critical: the return must be the map itself, not the `{ ok, data }` wrapper.
    expect(result).not.toHaveProperty("ok");
    expect(result).not.toHaveProperty("data");
    expect(result[1]?.circuitState).toBe("open");
  });

  test("wraps provider group counts in ActionResult for the dashboard consumer", async () => {
    // 后端 listProviderGroups 经 actionJson() 解包，直接返回裸数组；
    // provider-group-select.tsx 却按 `{ ok, data }` 消费。若 api-client 不再包一层，
    // `res.ok` 永远 undefined，每次展开用户编辑面板都会误报 "获取供应商分组统计失败"。
    const groupCounts = [
      { group: "default", providerCount: 2 },
      { group: "prod", providerCount: 1 },
    ];
    getMock.mockResolvedValue(groupCounts);

    const result = await providers.getProviderGroupsWithCount();

    expect(getMock).toHaveBeenCalledWith("/api/v1/providers/groups?include=count", {
      headers: { [DASHBOARD_COMPAT_HEADER]: "1" },
    });
    expect(result).toEqual({ ok: true, data: groupCounts });
  });

  test("maps a failed provider group counts request to a failed ActionResult", async () => {
    getMock.mockRejectedValue(
      new ApiError({
        status: 403,
        errorCode: "auth.forbidden",
        detail: "Admin access is required.",
      })
    );

    const result = await providers.getProviderGroupsWithCount();

    // errorCode must arrive pre-mapped to an errors-namespace key so forms can
    // translate it directly (issue #1259: raw "auth.forbidden" rendered as the
    // literal fallback string "errors.auth.forbidden").
    expect(result).toEqual({
      ok: false,
      error: "Admin access is required.",
      errorCode: "PERMISSION_DENIED",
      errorParams: undefined,
    });
  });

  test("addKey hard-fails on 403 instead of silently retargeting to the self endpoint", async () => {
    // U03: the old 403 fallback could turn "create a key for user X" into
    // "create a key for myself" when the session lost admin rights mid-flight.
    postMock.mockRejectedValueOnce(
      new ApiError({
        status: 403,
        errorCode: "auth.forbidden",
        detail: "Admin access is required.",
      })
    );

    const result = await keys.addKey({ userId: 2, name: "self-key", providerGroup: "default" });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith(
      "/api/v1/users/2/keys",
      { name: "self-key", providerGroup: "default" },
      undefined
    );
    expect(result).toMatchObject({ ok: false, errorCode: "PERMISSION_DENIED" });
  });

  test("addOwnKey posts directly to the self key-creation endpoint", async () => {
    postMock.mockResolvedValueOnce({ id: 77, generatedKey: "sk-new", name: "self-key" });

    const result = await keys.addOwnKey({ name: "self-key", providerGroup: "default" });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith(
      "/api/v1/users:self/keys",
      { name: "self-key", providerGroup: "default" },
      undefined
    );
    expect(result).toEqual({
      ok: true,
      data: { id: 77, generatedKey: "sk-new", name: "self-key" },
    });
  });

  test("does not retry key creation for non-authorization failures", async () => {
    postMock.mockRejectedValue(
      new ApiError({
        status: 400,
        errorCode: "DUPLICATE_NAME",
        detail: "Key name already exists.",
      })
    );

    const result = await keys.addKey({ userId: 2, name: "self-key" });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      error: "Key name already exists.",
      errorCode: "DUPLICATE_NAME",
      errorParams: undefined,
    });
  });

  test("preserves business delete codes through toVoidActionResult (removeKey)", async () => {
    // The #1266 contract: CANNOT_DELETE_LAST_KEY must survive the void wrapper
    // unchanged (not collapsed to a generic code) so the toast shows the reason.
    deleteMock.mockRejectedValueOnce(
      new ApiError({
        status: 400,
        errorCode: "CANNOT_DELETE_LAST_KEY",
        detail: "Bad request",
      })
    );

    const result = await keys.removeKey(7);

    expect(deleteMock).toHaveBeenCalledWith("/api/v1/keys/7");
    expect(result).toEqual({
      ok: false,
      error: "Bad request",
      errorCode: "CANNOT_DELETE_LAST_KEY",
      errorParams: undefined,
    });
  });

  test("maps key.action_failed through toVoidActionResult to OPERATION_FAILED", async () => {
    deleteMock.mockRejectedValueOnce(
      new ApiError({ status: 400, errorCode: "key.action_failed", detail: "Bad request" })
    );

    const result = await keys.removeKey(7);

    expect(result).toMatchObject({ ok: false, errorCode: "OPERATION_FAILED" });
  });

  test("addOwnKey surfaces PERMISSION_DENIED for read-only sessions", async () => {
    // Drop any persistent implementation a prior test left on postMock so the
    // Once-rejection below is the only behavior in play.
    postMock.mockReset();
    postMock.mockRejectedValueOnce(
      new ApiError({
        status: 403,
        errorCode: "auth.forbidden",
        detail: "Read-only sessions cannot create keys.",
      })
    );

    const result = await keys.addOwnKey({ name: "self-key" });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith(
      "/api/v1/users:self/keys",
      { name: "self-key" },
      undefined
    );
    expect(result).toMatchObject({ ok: false, errorCode: "PERMISSION_DENIED" });
  });

  test("maps resource action_failed codes to translatable error codes", async () => {
    getMock.mockRejectedValue(
      new ApiError({
        status: 400,
        errorCode: "key.action_failed",
        detail: "Bad request",
      })
    );

    const result = await keys.getKeys(2);

    expect(result).toEqual({
      ok: false,
      error: "Bad request",
      errorCode: "OPERATION_FAILED",
      errorParams: undefined,
    });
  });

  test("wraps model suggestions in ActionResult for the autocomplete consumer", async () => {
    // 与分组统计同源：use-model-suggestions.ts 检查 `res.ok && res.data`，
    // 裸数组会让自动补全静默失效（不报错但永远拿不到建议模型）。
    const suggestions = ["claude-3-opus", "claude-3-sonnet"];
    getMock.mockResolvedValue(suggestions);

    const result = await providers.getModelSuggestionsByProviderGroup("default");

    expect(getMock).toHaveBeenCalledWith(
      "/api/v1/providers/model-suggestions?providerGroup=default",
      { headers: { [DASHBOARD_COMPAT_HEADER]: "1" } }
    );
    expect(result).toEqual({ ok: true, data: suggestions });
  });

  test("downloadUsageLogsExport returns the response body as a Blob", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Blob(["PKxlsx-bytes"]), {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": 'attachment; filename="usage-logs-job-9.xlsx"',
          },
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await usageLogs.downloadUsageLogsExport("job-9");

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/usage-logs/exports/job-9/download", {
      credentials: "include",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.blob).toBeInstanceOf(Blob);
    expect(await result.data.blob.text()).toBe("PKxlsx-bytes");
  });

  test("downloadUsageLogsExport surfaces a non-2xx download as an error result", async () => {
    const fetchMock = vi.fn(
      async () => new Response("nope", { status: 404, statusText: "Not Found" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await usageLogs.downloadUsageLogsExport("missing");

    expect(result.ok).toBe(false);
  });
});
