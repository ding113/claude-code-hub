import { Buffer } from "node:buffer";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "@/lib/api-client/v1/errors";

const getMock = vi.hoisted(() => vi.fn());
const patchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client/v1/client", () => ({
  apiClient: {
    get: getMock,
    patch: patchMock,
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

describe("v1 action compatibility client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        users: [{ id: 9, name: "self" }],
        nextCursor: null,
        hasMore: false,
      });

    await expect(users.getUsers()).resolves.toEqual([{ id: 9, name: "self" }]);

    expect(getMock).toHaveBeenNthCalledWith(1, "/api/v1/users");
    expect(getMock).toHaveBeenNthCalledWith(2, "/api/v1/users:self");
  });

  test("maps provider endpoint probe logs to the v1 resource endpoint", async () => {
    getMock.mockResolvedValue({ logs: [] });

    const result = await providerEndpoints.getProviderEndpointProbeLogs({
      endpointId: 12,
      limit: 50,
    });

    expect(getMock).toHaveBeenCalledWith("/api/v1/provider-endpoints/12/probe-logs?limit=50");
    expect(result).toEqual({ ok: true, data: { logs: [] } });
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
});
