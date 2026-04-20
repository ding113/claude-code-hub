import { beforeEach, describe, expect, it, vi } from "vitest";

function sqlToString(sqlObj: unknown): string {
  const visited = new Set<unknown>();

  const walk = (node: unknown): string => {
    if (!node || visited.has(node)) return "";
    visited.add(node);

    if (typeof node === "string") return node;

    if (typeof node === "object") {
      const anyNode = node as Record<string, unknown>;
      if (Array.isArray(anyNode)) {
        return anyNode.map(walk).join("");
      }

      if (Array.isArray(anyNode.value)) {
        return anyNode.value.map(String).join("");
      }

      if (typeof anyNode.value === "string") {
        return anyNode.value;
      }

      if ("queryChunks" in anyNode) {
        return walk(anyNode.queryChunks);
      }
    }

    return "";
  };

  return walk(sqlObj);
}

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSystemSettings: vi.fn(),
  isLedgerOnlyMode: vi.fn(),
  lookupIp: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  dbSelect: vi.fn(),
  dbFrom: vi.fn(),
  dbWhere: vi.fn(),
  dbLimit: vi.fn(),
  getTranslations: vi.fn(async () => (key: string, params?: Record<string, unknown>) =>
    params?.field ? `${key}:${String(params.field)}` : key
  ),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mocks.getSystemSettings,
}));

vi.mock("@/lib/ledger-fallback", () => ({
  isLedgerOnlyMode: mocks.isLedgerOnlyMode,
}));

vi.mock("@/lib/ip-geo/client", () => ({
  lookupIp: mocks.lookupIp,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: mocks.getTranslations,
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
    mocks.isLedgerOnlyMode.mockResolvedValue(false);
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

    expect(result).toMatchObject({
      ok: false,
      error: "UNAUTHORIZED",
      errorCode: "UNAUTHORIZED",
    });
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

    expect(result).toMatchObject({
      ok: false,
      error: "REQUIRED_FIELD:IP_ADDRESS_FIELD",
      errorCode: "REQUIRED_FIELD",
    });
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

    expect(result).toMatchObject({
      ok: false,
      error: "NOT_FOUND",
      errorCode: "NOT_FOUND",
    });
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

    expect(result).toMatchObject({
      ok: false,
      error: "INVALID_STATE",
      errorCode: "INVALID_STATE",
    });
    expect(mocks.dbLimit).not.toHaveBeenCalled();
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

  it("ledger-only 模式下也允许查询 usage_ledger 中可见的 IP", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { id: 7 },
      key: { id: 10, key: "sk-readonly" },
    });
    mocks.dbLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 99 }]);
    mocks.isLedgerOnlyMode.mockResolvedValueOnce(true);

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

  it("ledger-only 模式下的可见性校验必须带上计费可见条件", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { id: 7 },
      key: { id: 10, key: "sk-readonly" },
    });
    mocks.dbLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 99 }]);
    mocks.isLedgerOnlyMode.mockResolvedValueOnce(true);

    const { getMyIpGeoDetails } = await import("@/actions/my-usage");
    await getMyIpGeoDetails({ ip: "203.0.113.9", lang: "ja" });

    const ledgerWhere = sqlToString(mocks.dbWhere.mock.calls[1]?.[0]).toLowerCase();
    expect(ledgerWhere).toContain("is null");
    expect(ledgerWhere).toContain("sk-readonly");
  });

  it("lookup error 日志不记录原始 IP，只记录内部日志 ID", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { id: 7 },
      key: { id: 10, key: "sk-readonly" },
    });
    mocks.dbLimit.mockResolvedValueOnce([{ id: 42 }]);
    mocks.lookupIp.mockResolvedValueOnce({
      status: "error",
      error: "upstream down",
    });

    const { getMyIpGeoDetails } = await import("@/actions/my-usage");
    await getMyIpGeoDetails({ ip: "203.0.113.9", lang: "ja" });

    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "[my-usage] getMyIpGeoDetails lookup returned error",
      expect.objectContaining({
        messageRequestId: 42,
        keyId: 10,
        userId: 7,
        error: "upstream down",
      })
    );
    expect(mocks.loggerWarn).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ip: "203.0.113.9" })
    );
  });
});
