import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSystemSettings: vi.fn(),
  lookupIp: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  dbSelect: vi.fn(),
  dbFrom: vi.fn(),
  dbWhere: vi.fn(),
  dbLimit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mocks.getSystemSettings,
}));

vi.mock("@/lib/ip-geo/client", () => ({
  lookupIp: mocks.lookupIp,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    select: mocks.dbSelect,
  },
}));

describe("getMyIpGeoDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbSelect.mockReturnValue({
      from: mocks.dbFrom,
    });
    mocks.dbFrom.mockReturnValue({
      where: mocks.dbWhere,
    });
    mocks.dbWhere.mockReturnValue({
      limit: mocks.dbLimit,
    });
    mocks.getSystemSettings.mockResolvedValue({
      ipGeoLookupEnabled: true,
    });
    mocks.lookupIp.mockResolvedValue({
      status: "ok",
      data: {
        ip: "203.0.113.9",
        version: "ipv4",
        hostname: null,
      },
    });
  });

  it("未认证时返回 Unauthorized", async () => {
    mocks.getSession.mockResolvedValueOnce(null);

    const { getMyIpGeoDetails } = await import("@/actions/my-usage");
    const result = await getMyIpGeoDetails({ ip: "203.0.113.9", lang: "en" });

    expect(result).toEqual({ ok: false, error: "Unauthorized" });
    expect(mocks.getSession).toHaveBeenCalledWith({ allowReadOnlyAccess: true });
    expect(mocks.lookupIp).not.toHaveBeenCalled();
  });

  it("空 IP 返回校验错误", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { id: 1 },
      key: { id: 10, key: "sk-test" },
    });

    const { getMyIpGeoDetails } = await import("@/actions/my-usage");
    const result = await getMyIpGeoDetails({ ip: "   " });

    expect(result).toEqual({ ok: false, error: "IP is required" });
    expect(mocks.lookupIp).not.toHaveBeenCalled();
  });

  it("当前 key 日志里不存在该 IP 时拒绝查询", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { id: 1 },
      key: { id: 10, key: "sk-test" },
    });
    mocks.dbLimit.mockResolvedValueOnce([]);

    const { getMyIpGeoDetails } = await import("@/actions/my-usage");
    const result = await getMyIpGeoDetails({ ip: "198.51.100.88", lang: "en" });

    expect(result).toEqual({ ok: false, error: "IP not found in current key usage logs" });
    expect(mocks.lookupIp).not.toHaveBeenCalled();
  });

  it("系统关闭 IP 查询时返回禁用错误", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { id: 1 },
      key: { id: 10, key: "sk-test" },
    });
    mocks.dbLimit.mockResolvedValueOnce([{ id: 42 }]);
    mocks.getSystemSettings.mockResolvedValueOnce({
      ipGeoLookupEnabled: false,
    });

    const { getMyIpGeoDetails } = await import("@/actions/my-usage");
    const result = await getMyIpGeoDetails({ ip: "203.0.113.9", lang: "en" });

    expect(result).toEqual({ ok: false, error: "IP geolocation disabled" });
    expect(mocks.lookupIp).not.toHaveBeenCalled();
  });

  it("readonly 会话只能查询自己日志里出现过的 IP", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { id: 7 },
      key: { id: 10, key: "sk-readonly" },
    });
    mocks.dbLimit.mockResolvedValueOnce([{ id: 42 }]);

    const { getMyIpGeoDetails } = await import("@/actions/my-usage");
    const result = await getMyIpGeoDetails({ ip: "203.0.113.9", lang: "ja" });

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: "ok",
      },
    });
    expect(mocks.lookupIp).toHaveBeenCalledWith("203.0.113.9", { lang: "ja" });
  });
});
