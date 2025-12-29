import { describe, expect, it, vi } from "vitest";
import type { ModelPrice, ModelPriceData } from "@/types/model-price";
import type { SystemSettings } from "@/types/system-config";

vi.mock("@/repository/model-price", () => ({
  findLatestPriceByModel: vi.fn(),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(),
}));

import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { findLatestPriceByModel } from "@/repository/model-price";
import { getSystemSettings } from "@/repository/system-config";

function makeSystemSettings(
  billingModelSource: SystemSettings["billingModelSource"]
): SystemSettings {
  const now = new Date();
  return {
    id: 1,
    siteTitle: "test",
    allowGlobalUsageView: false,
    currencyDisplay: "USD",
    billingModelSource,
    enableAutoCleanup: false,
    cleanupRetentionDays: 30,
    cleanupSchedule: "0 2 * * *",
    cleanupBatchSize: 10000,
    enableClientVersionCheck: false,
    verboseProviderError: false,
    enableHttp2: false,
    createdAt: now,
    updatedAt: now,
  };
}

function makePriceRecord(modelName: string, priceData: ModelPriceData): ModelPrice {
  return {
    id: 1,
    modelName,
    priceData,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createSession({
  originalModel,
  redirectedModel,
}: {
  originalModel?: string | null;
  redirectedModel?: string | null;
}): ProxySession {
  const session = new (
    ProxySession as unknown as {
      new (init: {
        startTime: number;
        method: string;
        requestUrl: URL;
        headers: Headers;
        headerLog: string;
        request: { message: Record<string, unknown>; log: string; model: string | null };
        userAgent: string | null;
        context: unknown;
        clientAbortSignal: AbortSignal | null;
      }): ProxySession;
    }
  )({
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("http://localhost/v1/messages"),
    headers: new Headers(),
    headerLog: "",
    request: { message: {}, log: "(test)", model: redirectedModel ?? null },
    userAgent: null,
    context: {},
    clientAbortSignal: null,
  });

  if (originalModel !== undefined) {
    session.setOriginalModel(originalModel);
  }

  return session;
}

describe("ProxySession.getCachedPriceDataByBillingSource", () => {
  it("配置 = original 时应优先使用原始模型", async () => {
    const originalPriceData: ModelPriceData = { input_cost_per_token: 1, output_cost_per_token: 2 };
    const redirectedPriceData: ModelPriceData = {
      input_cost_per_token: 3,
      output_cost_per_token: 4,
    };

    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("original"));
    vi.mocked(findLatestPriceByModel).mockImplementation(async (modelName: string) => {
      if (modelName === "original-model") {
        return makePriceRecord(modelName, originalPriceData);
      }
      if (modelName === "redirected-model") {
        return makePriceRecord(modelName, redirectedPriceData);
      }
      return null;
    });

    const session = createSession({
      originalModel: "original-model",
      redirectedModel: "redirected-model",
    });

    const result = await session.getCachedPriceDataByBillingSource();
    expect(result).toEqual(originalPriceData);
    expect(findLatestPriceByModel).toHaveBeenCalledTimes(1);
    expect(findLatestPriceByModel).toHaveBeenCalledWith("original-model");
  });

  it("配置 = redirected 时应优先使用重定向后模型", async () => {
    const originalPriceData: ModelPriceData = { input_cost_per_token: 1, output_cost_per_token: 2 };
    const redirectedPriceData: ModelPriceData = {
      input_cost_per_token: 3,
      output_cost_per_token: 4,
    };

    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("redirected"));
    vi.mocked(findLatestPriceByModel).mockImplementation(async (modelName: string) => {
      if (modelName === "original-model") {
        return makePriceRecord(modelName, originalPriceData);
      }
      if (modelName === "redirected-model") {
        return makePriceRecord(modelName, redirectedPriceData);
      }
      return null;
    });

    const session = createSession({
      originalModel: "original-model",
      redirectedModel: "redirected-model",
    });

    const result = await session.getCachedPriceDataByBillingSource();
    expect(result).toEqual(redirectedPriceData);
    expect(findLatestPriceByModel).toHaveBeenCalledTimes(1);
    expect(findLatestPriceByModel).toHaveBeenCalledWith("redirected-model");
  });

  it("应忽略空 priceData 并回退到备选模型", async () => {
    const redirectedPriceData: ModelPriceData = {
      input_cost_per_token: 3,
      output_cost_per_token: 4,
    };

    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("original"));
    vi.mocked(findLatestPriceByModel)
      .mockResolvedValueOnce(makePriceRecord("original-model", {}))
      .mockResolvedValueOnce(makePriceRecord("redirected-model", redirectedPriceData));

    const session = createSession({
      originalModel: "original-model",
      redirectedModel: "redirected-model",
    });

    const result = await session.getCachedPriceDataByBillingSource();
    expect(result).toEqual(redirectedPriceData);
    expect(findLatestPriceByModel).toHaveBeenCalledTimes(2);
    expect(findLatestPriceByModel).toHaveBeenNthCalledWith(1, "original-model");
    expect(findLatestPriceByModel).toHaveBeenNthCalledWith(2, "redirected-model");
  });

  it("应在主模型无价格时回退到备选模型", async () => {
    const redirectedPriceData: ModelPriceData = {
      input_cost_per_token: 3,
      output_cost_per_token: 4,
    };

    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("original"));
    vi.mocked(findLatestPriceByModel)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makePriceRecord("redirected-model", redirectedPriceData));

    const session = createSession({
      originalModel: "original-model",
      redirectedModel: "redirected-model",
    });

    const result = await session.getCachedPriceDataByBillingSource();
    expect(result).toEqual(redirectedPriceData);
    expect(findLatestPriceByModel).toHaveBeenCalledTimes(2);
    expect(findLatestPriceByModel).toHaveBeenNthCalledWith(1, "original-model");
    expect(findLatestPriceByModel).toHaveBeenNthCalledWith(2, "redirected-model");
  });

  it("应在 getSystemSettings 失败时回退到 redirected", async () => {
    const redirectedPriceData: ModelPriceData = {
      input_cost_per_token: 3,
      output_cost_per_token: 4,
    };

    vi.mocked(getSystemSettings).mockRejectedValue(new Error("DB error"));
    vi.mocked(findLatestPriceByModel).mockResolvedValue(
      makePriceRecord("redirected-model", redirectedPriceData)
    );

    const session = createSession({
      originalModel: "original-model",
      redirectedModel: "redirected-model",
    });

    const result = await session.getCachedPriceDataByBillingSource();
    expect(result).toEqual(redirectedPriceData);
    expect(getSystemSettings).toHaveBeenCalledTimes(1);
    expect(findLatestPriceByModel).toHaveBeenCalledTimes(1);
    expect(findLatestPriceByModel).toHaveBeenCalledWith("redirected-model");

    const internal = session as unknown as { cachedBillingModelSource?: unknown };
    expect(internal.cachedBillingModelSource).toBe("redirected");
  });

  it("应在 billingModelSource 非法时回退到 redirected", async () => {
    const redirectedPriceData: ModelPriceData = {
      input_cost_per_token: 3,
      output_cost_per_token: 4,
    };

    vi.mocked(getSystemSettings).mockResolvedValue({
      ...makeSystemSettings("redirected"),
      billingModelSource: "invalid" as any,
    } as any);
    vi.mocked(findLatestPriceByModel).mockResolvedValue(
      makePriceRecord("redirected-model", redirectedPriceData)
    );

    const session = createSession({
      originalModel: "original-model",
      redirectedModel: "redirected-model",
    });

    const result = await session.getCachedPriceDataByBillingSource();
    expect(result).toEqual(redirectedPriceData);
    expect(findLatestPriceByModel).toHaveBeenCalledTimes(1);
    expect(findLatestPriceByModel).toHaveBeenCalledWith("redirected-model");

    const internal = session as unknown as { cachedBillingModelSource?: unknown };
    expect(internal.cachedBillingModelSource).toBe("redirected");
  });

  it("当原始模型等于重定向模型时应避免重复查询", async () => {
    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("original"));
    vi.mocked(findLatestPriceByModel).mockResolvedValue(null);

    const session = createSession({
      originalModel: "same-model",
      redirectedModel: "same-model",
    });

    const result = await session.getCachedPriceDataByBillingSource();
    expect(result).toBeNull();
    expect(findLatestPriceByModel).toHaveBeenCalledTimes(1);
    expect(findLatestPriceByModel).toHaveBeenCalledWith("same-model");
  });

  it("并发调用时应只读取一次配置", async () => {
    const priceData: ModelPriceData = { input_cost_per_token: 1, output_cost_per_token: 2 };

    vi.mocked(getSystemSettings).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return makeSystemSettings("redirected");
    });
    vi.mocked(findLatestPriceByModel).mockResolvedValue(
      makePriceRecord("redirected-model", priceData)
    );

    const session = createSession({
      originalModel: "original-model",
      redirectedModel: "redirected-model",
    });

    const p1 = session.getCachedPriceDataByBillingSource();
    const p2 = session.getCachedPriceDataByBillingSource();
    await Promise.all([p1, p2]);

    expect(getSystemSettings).toHaveBeenCalledTimes(1);
  });

  it("应缓存配置避免重复读取", async () => {
    const priceData: ModelPriceData = { input_cost_per_token: 1, output_cost_per_token: 2 };

    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("redirected"));
    vi.mocked(findLatestPriceByModel).mockResolvedValue(
      makePriceRecord("redirected-model", priceData)
    );

    const session = createSession({
      originalModel: "original-model",
      redirectedModel: "redirected-model",
    });

    await session.getCachedPriceDataByBillingSource();
    await session.getCachedPriceDataByBillingSource();

    expect(getSystemSettings).toHaveBeenCalledTimes(1);
  });

  it("应缓存价格数据避免重复查询", async () => {
    const priceData: ModelPriceData = { input_cost_per_token: 1, output_cost_per_token: 2 };

    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("redirected"));
    vi.mocked(findLatestPriceByModel).mockResolvedValue(
      makePriceRecord("redirected-model", priceData)
    );

    const session = createSession({
      originalModel: "original-model",
      redirectedModel: "redirected-model",
    });

    await session.getCachedPriceDataByBillingSource();
    await session.getCachedPriceDataByBillingSource();

    expect(findLatestPriceByModel).toHaveBeenCalledTimes(1);
  });

  it("应在无模型时返回 null", async () => {
    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("redirected"));

    const session = createSession({ redirectedModel: null });
    const result = await session.getCachedPriceDataByBillingSource();

    expect(result).toBeNull();
    expect(getSystemSettings).not.toHaveBeenCalled();
    expect(findLatestPriceByModel).not.toHaveBeenCalled();
  });
});

function createSessionForHeaders(headers: Headers): ProxySession {
  // 使用 ProxySession 的内部构造方法创建测试实例
  const testSession = ProxySession.fromContext as any;
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("https://example.com/v1/messages"),
    headers,
    originalHeaders: new Headers(headers), // 同步更新 originalHeaders
    headerLog: JSON.stringify(Object.fromEntries(headers.entries())),
    request: { message: {}, log: "" },
    userAgent: headers.get("user-agent"),
    context: null,
    clientAbortSignal: null,
    userName: "test-user",
    authState: null,
    provider: null,
    messageContext: null,
    sessionId: null,
    requestSequence: 1,
    originalFormat: "claude",
    providerType: null,
    originalModelName: null,
    originalUrlPathname: null,
    providerChain: [],
    cacheTtlResolved: null,
    context1mApplied: false,
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
  });

  return session;
}

describe("ProxySession - isHeaderModified", () => {
  it("应该检测到被修改的 header", () => {
    const headers = new Headers([["user-agent", "original"]]);
    const session = createSessionForHeaders(headers);

    session.headers.set("user-agent", "modified");

    expect(session.isHeaderModified("user-agent")).toBe(true);
  });

  it("应该检测未修改的 header", () => {
    const headers = new Headers([["user-agent", "same"]]);
    const session = createSessionForHeaders(headers);

    expect(session.isHeaderModified("user-agent")).toBe(false);
  });

  it("应该处理不存在的 header", () => {
    const headers = new Headers();
    const session = createSessionForHeaders(headers);

    expect(session.isHeaderModified("x-custom")).toBe(false);
  });

  it("应该检测到被删除的 header", () => {
    const headers = new Headers([["user-agent", "original"]]);
    const session = createSessionForHeaders(headers);

    session.headers.delete("user-agent");

    expect(session.isHeaderModified("user-agent")).toBe(true);
  });

  it("应该检测到新增的 header", () => {
    const headers = new Headers();
    const session = createSessionForHeaders(headers);

    session.headers.set("x-new-header", "new-value");

    expect(session.isHeaderModified("x-new-header")).toBe(true);
  });

  it("应该区分空字符串和 null", () => {
    const headers = new Headers([["x-test", ""]]);
    const session = createSessionForHeaders(headers);

    session.headers.delete("x-test");

    expect(session.isHeaderModified("x-test")).toBe(true); // "" -> null
    expect(session.headers.get("x-test")).toBeNull();
  });
});
